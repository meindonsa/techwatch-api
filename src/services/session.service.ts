import { signAccessToken, signRefreshToken } from './auth.service.js'
import { createRefreshToken } from '../repositories/refresh-token.repository.js'
import type { User } from '../repositories/user.repository.js'

/**
 * Ouvre une session pour un utilisateur : émet l'access token et le refresh token,
 * et stocke ce dernier en base. Utilisé par le login classique et par OAuth.
 */
export async function issueSession(user: User) {
    const accessToken = await signAccessToken(user.id, user.username, user.email)
    const refreshToken = await signRefreshToken(user.id, user.username, user.email)

    const expiresAt = new Date()
    const expirationDays = parseInt(process.env.JWT_REFRESH_EXPIRATION?.replace('d', '') || '7')
    expiresAt.setDate(expiresAt.getDate() + expirationDays)

    await createRefreshToken(user.id, refreshToken, expiresAt)

    const { password: _, ...safeUser } = user

    return { accessToken, refreshToken, user: safeUser }
}
