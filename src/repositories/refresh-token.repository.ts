import { db } from '../db/index.js'

export interface RefreshToken {
    id: number
    user_id: number
    token: string
    expires_at: Date
    created_at: Date
}

export async function createRefreshToken(userId: number, token: string, expiresAt: Date): Promise<void> {
    await db.query(`
        INSERT INTO refresh_tokens (user_id, token, expires_at)
        VALUES ($1, $2, $3)
    `, [userId, token, expiresAt])
}

export async function findRefreshToken(token: string): Promise<RefreshToken | undefined> {
    const result = await db.query(`
        SELECT * FROM refresh_tokens WHERE token = $1
    `, [token])
    return result.rows[0] as RefreshToken | undefined
}

export async function deleteRefreshToken(token: string): Promise<void> {
    await db.query(`DELETE FROM refresh_tokens WHERE token = $1`, [token])
}

export async function deleteUserRefreshTokens(userId: number): Promise<void> {
    await db.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [userId])
}

export async function cleanupExpiredTokens(): Promise<void> {
    await db.query(`DELETE FROM refresh_tokens WHERE expires_at < NOW()`)
}
