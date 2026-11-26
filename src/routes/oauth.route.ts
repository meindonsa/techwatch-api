import { timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import { getUserById } from '../repositories/user.repository.js'
import {
    buildAuthorizationUrl,
    fetchProfile,
    generateCodeVerifier,
    generateState,
    getProviderConfig,
} from '../services/oauth.service.js'
import { linkProfileToUser, resolveOAuthUser } from '../services/oauth-user.service.js'
import { takeLinkState } from '../services/oauth-state.service.js'
import { consumeLoginCode, createLoginCode } from '../services/oauth-code.service.js'
import { issueSession } from '../services/session.service.js'
import { isOAuthProvider, OAuthError, type OAuthProvider } from '../utils/oauth.js'

const oauthRoute = new Hono()

const COOKIE_MAX_AGE_SECONDS = 600
const COOKIE_PATH = '/auth'

/** Chemins du front (sur FRONTEND_URL) vers lesquels l'API redirige à la fin du flux. */
const FRONT_SUCCESS_PATH = '/oauth/callback'
const FRONT_ERROR_PATH = '/login'
/** Page de profil : reçoit `?linked=<provider>` ou `?link_error=<code>` après une liaison. */
const FRONT_PROFILE_PATH = '/profile'

const exchangeSchema = z.object({
    code: z.string().min(1, 'Le code est requis'),
})

const stateCookie = (provider: OAuthProvider) => `oauth_state_${provider}`
const verifierCookie = (provider: OAuthProvider) => `oauth_verifier_${provider}`

function cookieOptions() {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Lax' as const, // le callback est une navigation top-level : Lax suffit et reste protecteur
        path: COOKIE_PATH,
        maxAge: COOKIE_MAX_AGE_SECONDS,
    }
}

function safeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a)
    const bb = Buffer.from(b)
    return ba.length === bb.length && timingSafeEqual(ba, bb)
}

function frontUrl(path: string, params: Record<string, string>): string {
    const base = process.env.FRONTEND_URL ?? 'http://localhost:5173'
    const url = new URL(path, base)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    return url.toString()
}

// POST /auth/oauth/exchange — échange le code à usage unique contre la session (mêmes tokens que /auth/login)
oauthRoute.post('/oauth/exchange', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = exchangeSchema.safeParse(body)
    if (!parsed.success) {
        return c.json({ error: parsed.error.issues[0].message }, 400)
    }

    const userId = consumeLoginCode(parsed.data.code)
    if (userId === undefined) {
        return c.json({ error: 'Code invalide ou expiré' }, 401)
    }

    const user = await getUserById(userId)
    if (!user) {
        return c.json({ error: 'Code invalide ou expiré' }, 401)
    }

    return c.json(await issueSession(user))
})

// GET /auth/:provider — redirige vers la page de consentement Google ou GitHub
oauthRoute.get('/:provider', (c) => {
    const provider = c.req.param('provider')
    if (!isOAuthProvider(provider)) return c.json({ error: 'Provider inconnu' }, 404)

    if (!getProviderConfig(provider)) {
        return c.redirect(frontUrl(FRONT_ERROR_PATH, { error: 'not_configured' }))
    }

    const state = generateState()
    const codeVerifier = provider === 'google' ? generateCodeVerifier() : undefined

    setCookie(c, stateCookie(provider), state, cookieOptions())
    if (codeVerifier) setCookie(c, verifierCookie(provider), codeVerifier, cookieOptions())

    return c.redirect(buildAuthorizationUrl(provider, state, codeVerifier).toString())
})

// GET /auth/:provider/callback — le provider renvoie ici avec ?code=...&state=...
oauthRoute.get('/:provider/callback', async (c) => {
    const provider = c.req.param('provider')
    if (!isOAuthProvider(provider)) return c.json({ error: 'Provider inconnu' }, 404)

    const fail = (code: string) => c.redirect(frontUrl(FRONT_ERROR_PATH, { error: code }))

    const expectedState = getCookie(c, stateCookie(provider))
    const codeVerifier = getCookie(c, verifierCookie(provider))
    // Cookies à usage unique : on les supprime quoi qu'il arrive.
    deleteCookie(c, stateCookie(provider), { path: COOKIE_PATH })
    deleteCookie(c, verifierCookie(provider), { path: COOKIE_PATH })

    const state = c.req.query('state')
    const code = c.req.query('code')

    // Mode liaison : le state a été émis par POST /users/me/oauth/:provider/start pour un utilisateur connecté.
    const linkState = state ? takeLinkState(state) : undefined
    if (linkState) {
        const failLink = (error: string) => c.redirect(frontUrl(FRONT_PROFILE_PATH, { link_error: error }))

        if (linkState.provider !== provider) return failLink('invalid_state')
        if (c.req.query('error')) return failLink('access_denied')
        if (!code) return failLink('invalid_state')

        try {
            const profile = await fetchProfile(provider, code, linkState.codeVerifier)
            await linkProfileToUser(linkState.userId, profile)
            return c.redirect(frontUrl(FRONT_PROFILE_PATH, { linked: provider }))
        } catch (e) {
            if (e instanceof OAuthError) {
                if (e.code === 'provider_error') console.error(`[oauth:${provider}:link]`, e.message)
                return failLink(e.code)
            }
            console.error(`[oauth:${provider}:link] erreur inattendue`, e)
            return failLink('provider_error')
        }
    }

    // Mode connexion : state vérifié contre le cookie posé par GET /auth/:provider.
    if (c.req.query('error')) {
        return fail('access_denied')
    }

    if (!expectedState || !state || !code || !safeEqual(state, expectedState)) {
        return fail('invalid_state')
    }

    try {
        const profile = await fetchProfile(provider, code, codeVerifier)
        const user = await resolveOAuthUser(profile)
        const loginCode = createLoginCode(user.id)
        return c.redirect(frontUrl(FRONT_SUCCESS_PATH, { code: loginCode }))
    } catch (e) {
        if (e instanceof OAuthError) {
            if (e.code === 'provider_error') console.error(`[oauth:${provider}]`, e.message)
            return fail(e.code)
        }
        console.error(`[oauth:${provider}] erreur inattendue`, e)
        return fail('provider_error')
    }
})

export default oauthRoute
