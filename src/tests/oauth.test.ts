import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.hoisted(() => {
    process.env.JWT_SECRET = 'test-secret-key-for-testing-only'
    process.env.DATABASE_URL = 'postgresql://test:test@localhost/test'
    process.env.FRONTEND_URL = 'http://front.test'
    process.env.GOOGLE_CLIENT_ID = 'g-id'
    process.env.GOOGLE_CLIENT_SECRET = 'g-secret'
    process.env.GOOGLE_REDIRECT_URI = 'http://api.test/auth/google/callback'
    process.env.GITHUB_CLIENT_ID = 'gh-id'
    process.env.GITHUB_CLIENT_SECRET = 'gh-secret'
    process.env.GITHUB_REDIRECT_URI = 'http://api.test/auth/github/callback'
})

const users = vi.hoisted(() => ({
    getUserById: vi.fn(),
    getUserByEmailInsensitive: vi.fn(),
    createOAuthUser: vi.fn(),
}))
const accounts = vi.hoisted(() => ({
    findOAuthAccount: vi.fn(),
    linkOAuthAccount: vi.fn(),
}))
const refresh = vi.hoisted(() => ({ createRefreshToken: vi.fn() }))

vi.mock('../repositories/user.repository.js', () => users)
vi.mock('../repositories/oauth-account.repository.js', () => accounts)
vi.mock('../repositories/refresh-token.repository.js', () => refresh)

import { sanitizeUsernameBase, usernameCandidates } from '../utils/username.js'
import { resolveOAuthUser } from '../services/oauth-user.service.js'
import { buildAuthorizationUrl, fetchProfile } from '../services/oauth.service.js'
import { consumeLoginCode, createLoginCode } from '../services/oauth-code.service.js'
import { OAuthError, type OAuthProfile } from '../utils/oauth.js'
import oauthRoute from '../routes/oauth.route.js'

const profile: OAuthProfile = {
    provider: 'github',
    providerUserId: '42',
    email: 'boris@example.com',
    emailVerified: true,
    name: 'Boris',
}

const dbUser = (over: Record<string, unknown> = {}) => ({
    id: 1,
    username: 'boris',
    email: 'boris@example.com',
    full_name: 'Boris',
    password: null,
    created_at: new Date(),
    ...over,
})

beforeEach(() => {
    vi.clearAllMocks()
})

describe('username', () => {
    it('nettoie accents, majuscules et caractères spéciaux', () => {
        expect(sanitizeUsernameBase('Élodie.Dupont+news')).toBe('elodie_dupont_news')
    })

    it('tronque à 20 caractères', () => {
        expect(sanitizeUsernameBase('a'.repeat(50)).length).toBe(20)
    })

    it('retombe sur "user" si la base est trop courte', () => {
        expect(sanitizeUsernameBase('..')).toBe('user')
    })

    it('propose la base seule en premier puis des variantes suffixées', () => {
        const [first, ...rest] = usernameCandidates('boris@example.com')
        expect(first).toBe('boris')
        expect(rest.length).toBeGreaterThan(0)
        for (const c of rest) expect(c).toMatch(/^boris_\d{6}$/)
    })
})

describe('resolveOAuthUser', () => {
    it('connecte un compte déjà lié sans rien créer', async () => {
        accounts.findOAuthAccount.mockResolvedValue({ user_id: 1 })
        users.getUserById.mockResolvedValue(dbUser())

        const user = await resolveOAuthUser(profile)

        expect(user.id).toBe(1)
        expect(users.createOAuthUser).not.toHaveBeenCalled()
    })

    it('refuse un email non vérifié', async () => {
        accounts.findOAuthAccount.mockResolvedValue(undefined)

        await expect(resolveOAuthUser({ ...profile, emailVerified: false })).rejects.toMatchObject({
            code: 'email_not_verified',
        })
        expect(users.createOAuthUser).not.toHaveBeenCalled()
    })

    it("ne fusionne pas avec un compte à mot de passe existant", async () => {
        accounts.findOAuthAccount.mockResolvedValue(undefined)
        users.getUserByEmailInsensitive.mockResolvedValue(dbUser({ password: 'hash' }))

        await expect(resolveOAuthUser(profile)).rejects.toMatchObject({ code: 'email_exists' })
        expect(accounts.linkOAuthAccount).not.toHaveBeenCalled()
        expect(users.createOAuthUser).not.toHaveBeenCalled()
    })

    it('lie un second provider à un compte purement OAuth', async () => {
        accounts.findOAuthAccount.mockResolvedValue(undefined)
        users.getUserByEmailInsensitive.mockResolvedValue(dbUser({ password: null }))

        const user = await resolveOAuthUser(profile)

        expect(user.id).toBe(1)
        expect(accounts.linkOAuthAccount).toHaveBeenCalledWith(1, 'github', '42', 'boris@example.com')
    })

    it('crée un nouveau compte avec des pseudos candidats', async () => {
        accounts.findOAuthAccount.mockResolvedValue(undefined)
        users.getUserByEmailInsensitive.mockResolvedValue(undefined)
        users.createOAuthUser.mockResolvedValue(dbUser({ id: 7 }))

        const user = await resolveOAuthUser(profile)

        expect(user.id).toBe(7)
        const args = users.createOAuthUser.mock.calls[0]
        expect(args[0]).toBe('boris@example.com')
        expect(args[1]).toBe('Boris')
        expect(args[4][0]).toBe('boris')
    })

    it('reprend le compte créé par un callback concurrent', async () => {
        accounts.findOAuthAccount
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce({ user_id: 9 })
        users.getUserByEmailInsensitive.mockResolvedValue(undefined)
        users.createOAuthUser.mockRejectedValue(Object.assign(new Error('dup'), { code: '23505' }))
        users.getUserById.mockResolvedValue(dbUser({ id: 9 }))

        const user = await resolveOAuthUser(profile)
        expect(user.id).toBe(9)
    })
})

describe('buildAuthorizationUrl', () => {
    it('Google : PKCE S256, scopes openid email profile et state', () => {
        const url = buildAuthorizationUrl('google', 'st', 'verifier')
        expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
        expect(url.searchParams.get('client_id')).toBe('g-id')
        expect(url.searchParams.get('state')).toBe('st')
        expect(url.searchParams.get('code_challenge_method')).toBe('S256')
        expect(url.searchParams.get('code_challenge')).toBeTruthy()
        expect(url.searchParams.get('scope')).toBe('openid email profile')
    })

    it('GitHub : scope user:email et redirect_uri', () => {
        const url = buildAuthorizationUrl('github', 'st')
        expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize')
        expect(url.searchParams.get('scope')).toContain('user:email')
        expect(url.searchParams.get('redirect_uri')).toBe('http://api.test/auth/github/callback')
    })
})

describe('fetchProfile (GitHub)', () => {
    const fetchMock = vi.fn()
    beforeEach(() => vi.stubGlobal('fetch', fetchMock))
    afterEach(() => {
        vi.unstubAllGlobals()
        fetchMock.mockReset()
    })

    const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

    it("choisit l'email principal et vérifié, pas celui du profil public", async () => {
        fetchMock
            .mockResolvedValueOnce(json({ access_token: 'tok' }))
            .mockResolvedValueOnce(json({ id: 42, login: 'bor', name: 'Boris', email: 'public@evil.test' }))
            .mockResolvedValueOnce(
                json([
                    { email: 'old@example.com', primary: false, verified: true },
                    { email: 'Main@Example.com', primary: true, verified: true },
                ])
            )

        const p = await fetchProfile('github', 'code')

        expect(p).toMatchObject({
            provider: 'github',
            providerUserId: '42',
            email: 'main@example.com',
            emailVerified: true,
        })
    })

    it('refuse un compte sans aucun email vérifié', async () => {
        fetchMock
            .mockResolvedValueOnce(json({ access_token: 'tok' }))
            .mockResolvedValueOnce(json({ id: 42, login: 'bor' }))
            .mockResolvedValueOnce(json([{ email: 'x@example.com', primary: true, verified: false }]))

        await expect(fetchProfile('github', 'code')).rejects.toMatchObject({ code: 'email_not_verified' })
    })

    it('signale une erreur provider quand GitHub refuse le code (réponse 200 avec error)', async () => {
        fetchMock.mockResolvedValueOnce(json({ error: 'bad_verification_code' }))

        await expect(fetchProfile('github', 'bad')).rejects.toBeInstanceOf(OAuthError)
    })
})

describe('login code', () => {
    it('est à usage unique', () => {
        const code = createLoginCode(5)
        expect(consumeLoginCode(code)).toBe(5)
        expect(consumeLoginCode(code)).toBeUndefined()
    })

    it('refuse un code inconnu', () => {
        expect(consumeLoginCode('inconnu')).toBeUndefined()
    })
})

describe('routes OAuth', () => {
    it('GET /github redirige vers GitHub et pose le cookie state', async () => {
        const res = await oauthRoute.request('/github')
        expect(res.status).toBe(302)
        expect(res.headers.get('location')).toContain('https://github.com/login/oauth/authorize')
        const cookie = res.headers.get('set-cookie') ?? ''
        expect(cookie).toContain('oauth_state_github=')
        expect(cookie).toContain('HttpOnly')
    })

    it('GET /google pose aussi le cookie code_verifier', async () => {
        const res = await oauthRoute.request('/google')
        expect(res.status).toBe(302)
        expect(res.headers.get('set-cookie') ?? '').toContain('oauth_verifier_google=')
    })

    it('provider inconnu → 404', async () => {
        expect((await oauthRoute.request('/facebook')).status).toBe(404)
        expect((await oauthRoute.request('/facebook/callback')).status).toBe(404)
    })

    it('callback sans cookie state → invalid_state', async () => {
        const res = await oauthRoute.request('/github/callback?code=abc&state=xyz')
        expect(res.status).toBe(302)
        expect(res.headers.get('location')).toBe('http://front.test/login?error=invalid_state')
    })

    it('callback avec state différent du cookie → invalid_state', async () => {
        const res = await oauthRoute.request('/github/callback?code=abc&state=autre', {
            headers: { Cookie: 'oauth_state_github=attendu' },
        })
        expect(res.headers.get('location')).toBe('http://front.test/login?error=invalid_state')
    })

    it("callback quand l'utilisateur refuse le consentement → access_denied", async () => {
        const res = await oauthRoute.request('/github/callback?error=access_denied', {
            headers: { Cookie: 'oauth_state_github=s' },
        })
        expect(res.headers.get('location')).toBe('http://front.test/login?error=access_denied')
    })

    it('POST /oauth/exchange : code invalide → 401', async () => {
        const res = await oauthRoute.request('/oauth/exchange', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: 'nope' }),
        })
        expect(res.status).toBe(401)
    })

    it('POST /oauth/exchange : code valide → session, et le code ne sert qu une fois', async () => {
        users.getUserById.mockResolvedValue(dbUser({ id: 3 }))
        const code = createLoginCode(3)
        const call = () =>
            oauthRoute.request('/oauth/exchange', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code }),
            })

        const first = await call()
        expect(first.status).toBe(200)
        const body = await first.json()
        expect(body.accessToken).toBeTruthy()
        expect(body.refreshToken).toBeTruthy()
        expect(body.user.password).toBeUndefined()
        expect(refresh.createRefreshToken).toHaveBeenCalledOnce()

        expect((await call()).status).toBe(401)
    })
})
