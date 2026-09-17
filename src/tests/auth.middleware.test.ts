import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { SignJWT } from 'jose'

vi.hoisted(() => {
    process.env.API_SECRET_TOKEN = 'test-token'
    process.env.JWT_SECRET = 'test-secret-key-for-testing-only'
})

import { authMiddleware } from '../middlewares/auth.middleware.js'

const app = new Hono()
app.use('*', authMiddleware)
app.post('/', (c) => c.json({ ok: true }))

const secret = new TextEncoder().encode('test-secret-key-for-testing-only')

async function createTestToken(userId: number, username: string): Promise<string> {
    return new SignJWT({ userId, username, type: 'access' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('15m')
        .sign(secret)
}

describe('authMiddleware', () => {
    it('retourne 403 si pas de header X-App-Token', async () => {
        const res = await app.request('/detect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify('dev.to'),
        })
        expect(res.status).toBe(403)
    })

    it('retourne 403 si pas de header Authorization', async () => {
        const res = await app.request('/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-App-Token': 'cs test-token',
            },
            body: JSON.stringify('dev.to'),
        })
        expect(res.status).toBe(403)
    })

    it('retourne 401 si token invalide', async () => {
        const res = await app.request('/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-App-Token': 'cs test-token',
                Authorization: 'Bearer mauvais-token',
            },
            body: JSON.stringify('dev.to'),
        })
        expect(res.status).toBe(401)
    })

    it('laisse passer si token valide', async () => {
        const validToken = await createTestToken(1, 'testuser')
        const res = await app.request('/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-App-Token': 'cs test-token',
                Authorization: `Bearer ${validToken}`,
            },
            body: JSON.stringify('dev.to'),
        })
        expect(res.status).toBe(200)
    })
})