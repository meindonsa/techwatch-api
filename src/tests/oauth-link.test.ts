import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'

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
    updatePassword: vi.fn(),
    deleteUser: vi.fn(),
    verifyPassword: vi.fn(),
    updateFullName: vi.fn(),
    usernameExists: vi.fn(),
}))
const accounts = vi.hoisted(() => ({
    findOAuthAccount: vi.fn(),
    findOAuthAccountByUser: vi.fn(),
    listOAuthAccountsByUser: vi.fn(),
    linkOAuthAccount: vi.fn(),
    unlinkOAuthAccount: vi.fn(),
}))

vi.mock('../repositories/user.repository.js', () => users)
vi.mock('../repositories/oauth-account.repository.js', () => accounts)
vi.mock('../repositories/refresh-token.repository.js', () => ({
    createRefreshToken: vi.fn(),
    deleteUserRefreshTokens: vi.fn(),
}))
vi.mock('../repositories/article.repository.js', () => ({ getArticlesByUser: vi.fn() }))

import { linkProfileToUser } from '../services/oauth-user.service.js'
import { saveLinkState, takeLinkState } from '../services/oauth-state.service.js'
import { type OAuthProfile } from '../utils/oauth.js'
import oauthRoute from '../routes/oauth.route.js'
import userRoute from '../routes/user.route.js'

const profile: OAuthProfile = {
    provider: 'google',
    providerUserId: 'g-123',
    email: 'perso@gmail.com',
    emailVerified: true,
    name: 'Boris',
}

const dbUser = (over: Record<string, unknown> = {}) => ({
    id: 1,
    username: 'boris',
    email: 'pro@example.com',
    full_name: 'Boris',
    password: 'hash',
    created_at: new Date(),
    ...over,
})

beforeEach(() => {
    vi.clearAllMocks()
})

describe('linkProfileToUser', () => {
    it("lie l'identité même si l'email du provider diffère de celui du compte", async () => {
        accounts.findOAuthAccount.mockResolvedValue(undefined)
        accounts.findOAuthAccountByUser.mockResolvedValue(undefined)
        accounts.linkOAuthAccount.mockResolvedValue(true)

        await linkProfileToUser(1, { ...profile, emailVerified: false })

        expect(accounts.linkOAuthAccount).toHaveBeenCalledWith(1, 'google', 'g-123', 'perso@gmail.com')
    })

    it('refuse une identité déjà liée à un autre utilisateur', async () => {
        accounts.findOAuthAccount.mockResolvedValue({ user_id: 2 })

        await expect(linkProfileToUser(1, profile)).rejects.toMatchObject({ code: 'already_linked' })
        expect(accounts.linkOAuthAccount).not.toHaveBeenCalled()
    })

    it('est idempotent si l identité est déjà liée au même utilisateur', async () => {
        accounts.findOAuthAccount.mockResolvedValue({ user_id: 1 })

        await expect(linkProfileToUser(1, profile)).resolves.toBeUndefined()
        expect(accounts.linkOAuthAccount).not.toHaveBeenCalled()
    })

    it("refuse un second compte du même provider pour l'utilisateur", async () => {
        accounts.findOAuthAccount.mockResolvedValue(undefined)
        accounts.findOAuthAccountByUser.mockResolvedValue({ user_id: 1, provider: 'google' })

        await expect(linkProfileToUser(1, profile)).rejects.toMatchObject({
            code: 'provider_already_linked',
        })
    })

    it('gère un conflit concurrent : identité prise entre-temps par un autre utilisateur', async () => {
        accounts.findOAuthAccount
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce({ user_id: 2 })
        accounts.findOAuthAccountByUser.mockResolvedValue(undefined)
        accounts.linkOAuthAccount.mockResolvedValue(false)

        await expect(linkProfileToUser(1, profile)).rejects.toMatchObject({ code: 'already_linked' })
    })
})

describe('état de liaison', () => {
    it('est à usage unique', () => {
        saveLinkState('s1', { userId: 1, provider: 'github' })
        expect(takeLinkState('s1')).toMatchObject({ userId: 1, provider: 'github' })
        expect(takeLinkState('s1')).toBeUndefined()
    })
})

// Les routes /users sont normalement derrière authMiddleware : on simule l'utilisateur connecté.
const app = new Hono()
app.use('*', async (c, next) => {
    c.set('userId' as never, 1 as never)
    await next()
})
app.route('/users', userRoute)

describe('GET /users/me/oauth', () => {
    it('liste les providers, leur état et la présence d un mot de passe', async () => {
        users.getUserById.mockResolvedValue(dbUser({ password: null }))
        accounts.listOAuthAccountsByUser.mockResolvedValue([
            { provider: 'github', email: 'gh@example.com', created_at: new Date('2026-11-26') },
        ])

        const res = await app.request('/users/me/oauth')
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(body.hasPassword).toBe(false)
        expect(body.providers).toEqual([
            expect.objectContaining({ provider: 'google', linked: false, configured: true }),
            expect.objectContaining({ provider: 'github', linked: true, email: 'gh@example.com' }),
        ])
    })
})

describe('POST /users/me/oauth/:provider/start', () => {
    it("renvoie l'URL du provider et enregistre un state lié à l'utilisateur", async () => {
        accounts.findOAuthAccountByUser.mockResolvedValue(undefined)

        const res = await app.request('/users/me/oauth/github/start', { method: 'POST' })
        const { url } = await res.json()

        expect(res.status).toBe(200)
        const parsed = new URL(url)
        expect(parsed.origin).toBe('https://github.com')
        const state = parsed.searchParams.get('state')!
        expect(takeLinkState(state)).toMatchObject({ userId: 1, provider: 'github' })
    })

    it('Google : conserve le code_verifier côté serveur', async () => {
        accounts.findOAuthAccountByUser.mockResolvedValue(undefined)

        const res = await app.request('/users/me/oauth/google/start', { method: 'POST' })
        const { url } = await res.json()
        const state = new URL(url).searchParams.get('state')!

        expect(takeLinkState(state)?.codeVerifier).toBeTruthy()
    })

    it('409 si le provider est déjà lié', async () => {
        accounts.findOAuthAccountByUser.mockResolvedValue({ user_id: 1 })

        const res = await app.request('/users/me/oauth/github/start', { method: 'POST' })

        expect(res.status).toBe(409)
        expect((await res.json()).code).toBe('provider_already_linked')
    })

    it('404 pour un provider inconnu', async () => {
        const res = await app.request('/users/me/oauth/facebook/start', { method: 'POST' })
        expect(res.status).toBe(404)
    })
})

describe('DELETE /users/me/oauth/:provider', () => {
    it('dissocie un provider', async () => {
        accounts.unlinkOAuthAccount.mockResolvedValue('unlinked')

        const res = await app.request('/users/me/oauth/github', { method: 'DELETE' })

        expect(res.status).toBe(200)
        expect(accounts.unlinkOAuthAccount).toHaveBeenCalledWith(1, 'github')
    })

    it('409 si c est le dernier moyen de connexion', async () => {
        accounts.unlinkOAuthAccount.mockResolvedValue('last_login_method')

        const res = await app.request('/users/me/oauth/github', { method: 'DELETE' })

        expect(res.status).toBe(409)
        expect((await res.json()).code).toBe('last_login_method')
    })

    it('404 si le provider n est pas lié', async () => {
        accounts.unlinkOAuthAccount.mockResolvedValue('not_linked')

        const res = await app.request('/users/me/oauth/google', { method: 'DELETE' })

        expect(res.status).toBe(404)
    })
})

describe('callback en mode liaison', () => {
    const fetchMock = vi.fn()
    beforeEach(() => vi.stubGlobal('fetch', fetchMock))
    afterEach(() => {
        vi.unstubAllGlobals()
        fetchMock.mockReset()
    })

    const json = (body: unknown) =>
        new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

    const mockGithub = () =>
        fetchMock
            .mockResolvedValueOnce(json({ access_token: 'tok' }))
            .mockResolvedValueOnce(json({ id: 42, login: 'bor' }))
            .mockResolvedValueOnce(json([{ email: 'gh@example.com', primary: true, verified: true }]))

    it('lie le compte et redirige vers le profil', async () => {
        saveLinkState('link-ok', { userId: 1, provider: 'github' })
        mockGithub()
        accounts.findOAuthAccount.mockResolvedValue(undefined)
        accounts.findOAuthAccountByUser.mockResolvedValue(undefined)
        accounts.linkOAuthAccount.mockResolvedValue(true)

        const res = await oauthRoute.request('/github/callback?code=abc&state=link-ok')

        expect(res.status).toBe(302)
        expect(res.headers.get('location')).toBe('http://front.test/profile?linked=github')
        expect(accounts.linkOAuthAccount).toHaveBeenCalledWith(1, 'github', '42', 'gh@example.com')
        expect(users.createOAuthUser).not.toHaveBeenCalled()
    })

    it('redirige avec link_error=already_linked si l identité appartient à un autre utilisateur', async () => {
        saveLinkState('link-taken', { userId: 1, provider: 'github' })
        mockGithub()
        accounts.findOAuthAccount.mockResolvedValue({ user_id: 2 })

        const res = await oauthRoute.request('/github/callback?code=abc&state=link-taken')

        expect(res.headers.get('location')).toBe('http://front.test/profile?link_error=already_linked')
    })

    it('redirige avec link_error=access_denied quand l utilisateur refuse', async () => {
        saveLinkState('link-deny', { userId: 1, provider: 'github' })

        const res = await oauthRoute.request('/github/callback?error=access_denied&state=link-deny')

        expect(res.headers.get('location')).toBe('http://front.test/profile?link_error=access_denied')
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('refuse un state émis pour un autre provider', async () => {
        saveLinkState('link-other', { userId: 1, provider: 'google', codeVerifier: 'v' })

        const res = await oauthRoute.request('/github/callback?code=abc&state=link-other')

        expect(res.headers.get('location')).toBe('http://front.test/profile?link_error=invalid_state')
        expect(accounts.linkOAuthAccount).not.toHaveBeenCalled()
    })

    it('le state de liaison ne sert qu une fois (rejoué → mode connexion → invalid_state)', async () => {
        saveLinkState('link-once', { userId: 1, provider: 'github' })
        mockGithub()
        accounts.findOAuthAccount.mockResolvedValue(undefined)
        accounts.findOAuthAccountByUser.mockResolvedValue(undefined)
        accounts.linkOAuthAccount.mockResolvedValue(true)

        await oauthRoute.request('/github/callback?code=abc&state=link-once')
        const replay = await oauthRoute.request('/github/callback?code=abc&state=link-once')

        expect(replay.headers.get('location')).toBe('http://front.test/login?error=invalid_state')
    })
})
