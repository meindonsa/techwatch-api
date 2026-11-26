import { createHash, randomBytes } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { OAuthError, type OAuthProfile, type OAuthProvider } from '../utils/oauth.js'

/**
 * Flux OAuth 2.0 « Authorization Code » pour Google (avec PKCE) et GitHub.
 * Aucune dépendance externe : uniquement `fetch` et `jose`.
 */

const FETCH_TIMEOUT_MS = 10_000

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com']

const GITHUB_AUTH_URL = 'https://github.com/login/oauth/authorize'
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const GITHUB_USER_URL = 'https://api.github.com/user'
const GITHUB_EMAILS_URL = 'https://api.github.com/user/emails'

const googleJwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL))

interface ProviderConfig {
    clientId: string
    clientSecret: string
    redirectUri: string
}

export function getProviderConfig(provider: OAuthProvider): ProviderConfig | null {
    const prefix = provider.toUpperCase()
    const clientId = process.env[`${prefix}_CLIENT_ID`]
    const clientSecret = process.env[`${prefix}_CLIENT_SECRET`]
    const redirectUri = process.env[`${prefix}_REDIRECT_URI`]
    if (!clientId || !clientSecret || !redirectUri) return null
    return { clientId, clientSecret, redirectUri }
}

export function generateState(): string {
    return randomBytes(32).toString('base64url')
}

export function generateCodeVerifier(): string {
    return randomBytes(32).toString('base64url')
}

function codeChallenge(verifier: string): string {
    return createHash('sha256').update(verifier).digest('base64url')
}

function requireConfig(provider: OAuthProvider): ProviderConfig {
    const config = getProviderConfig(provider)
    if (!config) throw new OAuthError('not_configured', `OAuth ${provider} non configuré`)
    return config
}

/** Construit l'URL de la page de consentement du provider. */
export function buildAuthorizationUrl(
    provider: OAuthProvider,
    state: string,
    codeVerifier?: string
): URL {
    const { clientId, redirectUri } = requireConfig(provider)

    if (provider === 'google') {
        if (!codeVerifier) throw new Error('codeVerifier requis pour Google')
        const url = new URL(GOOGLE_AUTH_URL)
        url.searchParams.set('response_type', 'code')
        url.searchParams.set('client_id', clientId)
        url.searchParams.set('redirect_uri', redirectUri)
        url.searchParams.set('scope', 'openid email profile')
        url.searchParams.set('state', state)
        url.searchParams.set('code_challenge', codeChallenge(codeVerifier))
        url.searchParams.set('code_challenge_method', 'S256')
        return url
    }

    const url = new URL(GITHUB_AUTH_URL)
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('scope', 'read:user user:email')
    url.searchParams.set('state', state)
    return url
}

async function request(url: string, init: RequestInit): Promise<any> {
    let res: Response
    try {
        res = await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    } catch (e) {
        throw new OAuthError('provider_error', `Requête vers ${new URL(url).host} impossible`)
    }
    if (!res.ok) {
        throw new OAuthError('provider_error', `${new URL(url).host} a répondu ${res.status}`)
    }
    try {
        return await res.json()
    } catch {
        throw new OAuthError('provider_error', `Réponse invalide de ${new URL(url).host}`)
    }
}

async function fetchGoogleProfile(code: string, codeVerifier: string): Promise<OAuthProfile> {
    const { clientId, clientSecret, redirectUri } = requireConfig('google')

    const tokens = await request(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            code_verifier: codeVerifier,
        }),
    })

    if (typeof tokens.id_token !== 'string') {
        throw new OAuthError('provider_error', 'id_token manquant dans la réponse Google')
    }

    let claims
    try {
        const verified = await jwtVerify(tokens.id_token, googleJwks, {
            issuer: GOOGLE_ISSUERS,
            audience: clientId,
        })
        claims = verified.payload
    } catch {
        throw new OAuthError('provider_error', 'id_token Google invalide')
    }

    if (typeof claims.sub !== 'string' || typeof claims.email !== 'string') {
        throw new OAuthError('provider_error', 'Profil Google incomplet')
    }

    return {
        provider: 'google',
        providerUserId: claims.sub,
        email: claims.email.toLowerCase(),
        emailVerified: claims.email_verified === true || claims.email_verified === 'true',
        name: typeof claims.name === 'string' ? claims.name : '',
    }
}

async function fetchGithubProfile(code: string): Promise<OAuthProfile> {
    const { clientId, clientSecret, redirectUri } = requireConfig('github')

    const tokens = await request(GITHUB_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            redirect_uri: redirectUri,
        }),
    })

    // GitHub répond 200 avec { error: ... } quand le code est invalide ou expiré.
    if (typeof tokens.access_token !== 'string') {
        throw new OAuthError('provider_error', `Échange du code GitHub refusé (${tokens.error ?? 'inconnu'})`)
    }

    const headers = {
        Authorization: `Bearer ${tokens.access_token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'techwatch-api',
    }

    const user = await request(GITHUB_USER_URL, { headers })
    const emails = await request(GITHUB_EMAILS_URL, { headers })

    if (user.id === undefined || user.id === null || !Array.isArray(emails)) {
        throw new OAuthError('provider_error', 'Profil GitHub incomplet')
    }

    // L'email du profil public n'est pas fiable : on ne retient que l'email principal ET vérifié.
    const primary = emails.find((e: any) => e.primary === true && e.verified === true)
    const fallback = emails.find((e: any) => e.verified === true)
    const chosen = primary ?? fallback

    if (!chosen) {
        throw new OAuthError('email_not_verified', 'Aucun email vérifié sur le compte GitHub')
    }

    return {
        provider: 'github',
        providerUserId: String(user.id),
        email: String(chosen.email).toLowerCase(),
        emailVerified: true,
        name: typeof user.name === 'string' && user.name ? user.name : String(user.login ?? ''),
    }
}

/** Échange le `code` du callback contre l'identité vérifiée de l'utilisateur. */
export async function fetchProfile(
    provider: OAuthProvider,
    code: string,
    codeVerifier?: string
): Promise<OAuthProfile> {
    if (provider === 'google') {
        if (!codeVerifier) throw new OAuthError('invalid_state', 'code_verifier manquant')
        return fetchGoogleProfile(code, codeVerifier)
    }
    return fetchGithubProfile(code)
}
