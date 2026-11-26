import { db } from '../db/index.js'
import bcrypt from 'bcryptjs'
import type { OAuthProvider } from '../utils/oauth.js'

export async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10)
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
    return bcrypt.compare(password, hash)
}

export interface User {
    id: number
    username: string
    email: string
    full_name: string
    /** null pour un compte créé uniquement via Google/GitHub */
    password: string | null
    created_at: Date
}

export async function createUser(email: string, fullName: string, password: string): Promise<User> {
    const hashed = await hashPassword(password)
    const result = await db.query(`
    INSERT INTO users (email, full_name, username, password) VALUES ($1, $2, $3, $4) RETURNING *
  `, [email, fullName, email.split('@')[0] + '_' + Date.now(), hashed])
    return result.rows[0] as User
}

export async function getUserById(id: number): Promise<User | undefined> {
    const result = await db.query(`SELECT * FROM users WHERE id = $1`, [id])
    return result.rows[0] as User | undefined
}

export async function getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db.query(`SELECT * FROM users WHERE username = $1`, [username])
    return result.rows[0] as User | undefined
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
    const result = await db.query(`SELECT * FROM users WHERE email = $1`, [email])
    return result.rows[0] as User | undefined
}

export async function getUserByEmailInsensitive(email: string): Promise<User | undefined> {
    const result = await db.query(`SELECT * FROM users WHERE lower(email) = lower($1)`, [email])
    return result.rows[0] as User | undefined
}

function isUniqueViolation(e: any, constraintPart?: string): boolean {
    if (e?.code !== '23505') return false
    if (!constraintPart) return true
    return typeof e.constraint === 'string' && e.constraint.includes(constraintPart)
}

/**
 * Crée un utilisateur sans mot de passe et sa liaison OAuth dans la même transaction.
 * `usernames` : pseudos à essayer dans l'ordre ; on passe au suivant si le pseudo est déjà pris.
 * Toute autre violation d'unicité (email, liaison déjà existante) est relancée à l'appelant.
 */
export async function createOAuthUser(
    email: string,
    fullName: string,
    provider: OAuthProvider,
    providerUserId: string,
    usernames: string[]
): Promise<User> {
    const client = await db.connect()
    try {
        for (const username of usernames) {
            await client.query('BEGIN')
            try {
                const created = await client.query(
                    `INSERT INTO users (email, full_name, username, password)
                     VALUES ($1, $2, $3, NULL) RETURNING *`,
                    [email, fullName, username]
                )
                const user = created.rows[0] as User
                await client.query(
                    `INSERT INTO oauth_accounts (user_id, provider, provider_user_id, email)
                     VALUES ($1, $2, $3, $4)`,
                    [user.id, provider, providerUserId, email]
                )
                await client.query('COMMIT')
                return user
            } catch (e) {
                await client.query('ROLLBACK')
                if (isUniqueViolation(e, 'username')) continue
                throw e
            }
        }
        throw new Error('Impossible de générer un pseudo unique')
    } finally {
        client.release()
    }
}

export async function emailExists(email: string): Promise<boolean> {
    const result = await db.query(`SELECT 1 FROM users WHERE email = $1`, [email])
    return result.rowCount !== 0
}

export async function updateFullName(id: number, fullName: string): Promise<void> {
    await db.query(`UPDATE users SET full_name = $1 WHERE id = $2`, [fullName, id])
}

export async function usernameExists(username: string): Promise<boolean> {
    const result = await db.query(`SELECT 1 FROM users WHERE username = $1`, [username])
    return result.rowCount !== 0
}

export async function getAllUsers(): Promise<User[]> {
    const result = await db.query(`SELECT * FROM users`)
    return result.rows as User[]
}

export async function updatePassword(id: number, password: string): Promise<void> {
    const hashed = await hashPassword(password)
    await db.query(`UPDATE users SET password = $1 WHERE id = $2`, [hashed, id])
}

export async function deleteUser(id: number): Promise<void> {
    await db.query(`DELETE FROM users WHERE id = $1`, [id])
}