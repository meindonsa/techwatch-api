import { db } from '../db/index.js'
import type { OAuthProvider } from '../utils/oauth.js'

export interface OAuthAccount {
    id: string
    user_id: number
    provider: OAuthProvider
    provider_user_id: string
    email: string | null
    created_at: Date
}

export async function findOAuthAccount(
    provider: OAuthProvider,
    providerUserId: string
): Promise<OAuthAccount | undefined> {
    const result = await db.query(
        `SELECT * FROM oauth_accounts WHERE provider = $1 AND provider_user_id = $2`,
        [provider, providerUserId]
    )
    return result.rows[0] as OAuthAccount | undefined
}

export async function linkOAuthAccount(
    userId: number,
    provider: OAuthProvider,
    providerUserId: string,
    email: string | null
): Promise<void> {
    await db.query(
        `INSERT INTO oauth_accounts (user_id, provider, provider_user_id, email)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [userId, provider, providerUserId, email]
    )
}
