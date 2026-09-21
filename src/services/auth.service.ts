import { SignJWT, jwtVerify } from 'jose'

if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is required')
}

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET)
const ACCESS_EXPIRATION = process.env.JWT_ACCESS_EXPIRATION ?? '15m'
const REFRESH_EXPIRATION = process.env.JWT_REFRESH_EXPIRATION ?? '7d'
const RESET_EXPIRATION = process.env.JWT_RESET_EXPIRATION ?? '1h'

export interface JWTPayload {
    userId: number
    username: string
    email: string
    type: 'access' | 'refresh'
}

export interface ResetTokenPayload {
    userId: number
    email: string
    type: 'reset'
}

export async function signAccessToken(userId: number, username: string, email: string): Promise<string> {
    return new SignJWT({ userId, username, email, type: 'access' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(ACCESS_EXPIRATION)
        .sign(SECRET)
}

export async function signRefreshToken(userId: number, username: string, email: string): Promise<string> {
    return new SignJWT({ userId, username, email, type: 'refresh' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(REFRESH_EXPIRATION)
        .sign(SECRET)
}

export async function signResetToken(userId: number, email: string): Promise<string> {
    return new SignJWT({ userId, email, type: 'reset' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(RESET_EXPIRATION)
        .sign(SECRET)
}

export async function verifyToken(token: string): Promise<JWTPayload> {
    const { payload } = await jwtVerify(token, SECRET)
    return payload as unknown as JWTPayload
}

export async function verifyResetToken(token: string): Promise<ResetTokenPayload> {
    const { payload } = await jwtVerify(token, SECRET)
    const p = payload as unknown as ResetTokenPayload
    if (p.type !== 'reset') {
        throw new Error('Invalid token type')
    }
    return p
}