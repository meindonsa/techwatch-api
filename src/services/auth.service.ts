import { SignJWT, jwtVerify } from 'jose'

if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is required')
}

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET)
const ACCESS_EXPIRATION = process.env.JWT_ACCESS_EXPIRATION ?? '15m'
const REFRESH_EXPIRATION = process.env.JWT_REFRESH_EXPIRATION ?? '7d'

export interface JWTPayload {
    userId: number
    username: string
    email: string
    type: 'access' | 'refresh'
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

export async function verifyToken(token: string): Promise<JWTPayload> {
    const { payload } = await jwtVerify(token, SECRET)
    return payload as unknown as JWTPayload
}