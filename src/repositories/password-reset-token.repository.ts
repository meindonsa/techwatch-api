import { db } from '../db/index.js'

export interface PasswordResetToken {
    id: number
    user_id: number
    token: string
    expires_at: Date
    created_at: Date
}

export async function createPasswordResetToken(userId: number, token: string, expiresAt: Date): Promise<void> {
    await db.query(`
        INSERT INTO password_reset_tokens (user_id, token, expires_at)
        VALUES ($1, $2, $3)
    `, [userId, token, expiresAt])
}

export async function findPasswordResetToken(token: string): Promise<PasswordResetToken | undefined> {
    const result = await db.query(`
        SELECT * FROM password_reset_tokens WHERE token = $1
    `, [token])
    return result.rows[0] as PasswordResetToken | undefined
}

export async function deletePasswordResetToken(token: string): Promise<void> {
    await db.query(`DELETE FROM password_reset_tokens WHERE token = $1`, [token])
}

export async function deleteUserPasswordResetTokens(userId: number): Promise<void> {
    await db.query(`DELETE FROM password_reset_tokens WHERE user_id = $1`, [userId])
}

export async function cleanupExpiredTokens(): Promise<void> {
    await db.query(`DELETE FROM password_reset_tokens WHERE expires_at < NOW()`)
}