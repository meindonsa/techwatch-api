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

export type UnlinkResult = 'unlinked' | 'not_linked' | 'last_login_method'

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

export async function findOAuthAccountByUser(
    userId: number,
    provider: OAuthProvider
): Promise<OAuthAccount | undefined> {
    const result = await db.query(
        `SELECT * FROM oauth_accounts WHERE user_id = $1 AND provider = $2`,
        [userId, provider]
    )
    return result.rows[0] as OAuthAccount | undefined
}

export async function listOAuthAccountsByUser(userId: number): Promise<OAuthAccount[]> {
    const result = await db.query(
        `SELECT * FROM oauth_accounts WHERE user_id = $1 ORDER BY created_at`,
        [userId]
    )
    return result.rows as OAuthAccount[]
}

/** Retourne true si la liaison a été créée, false si une contrainte d'unicité l'a refusée. */
export async function linkOAuthAccount(
    userId: number,
    provider: OAuthProvider,
    providerUserId: string,
    email: string | null
): Promise<boolean> {
    const result = await db.query(
        `INSERT INTO oauth_accounts (user_id, provider, provider_user_id, email)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [userId, provider, providerUserId, email]
    )
    return result.rowCount === 1
}

/**
 * Supprime une liaison, sauf si c'était le dernier moyen de connexion du compte
 * (pas de mot de passe et aucun autre provider).
 * La ligne `users` est verrouillée pour que deux dissociations simultanées
 * ne puissent pas laisser le compte sans aucun moyen de connexion.
 */
export async function unlinkOAuthAccount(userId: number, provider: OAuthProvider): Promise<UnlinkResult> {
    const client = await db.connect()
    try {
        await client.query('BEGIN')

        const user = await client.query(`SELECT password FROM users WHERE id = $1 FOR UPDATE`, [userId])
        const linked = await client.query(`SELECT provider FROM oauth_accounts WHERE user_id = $1`, [userId])

        const providers = linked.rows.map((r: { provider: string }) => r.provider)
        if (!providers.includes(provider)) {
            await client.query('ROLLBACK')
            return 'not_linked'
        }

        const hasPassword = user.rows[0]?.password != null
        const otherProviders = providers.filter((p: string) => p !== provider).length
        if (!hasPassword && otherProviders === 0) {
            await client.query('ROLLBACK')
            return 'last_login_method'
        }

        await client.query(`DELETE FROM oauth_accounts WHERE user_id = $1 AND provider = $2`, [userId, provider])
        await client.query('COMMIT')
        return 'unlinked'
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {})
        throw e
    } finally {
        client.release()
    }
}
