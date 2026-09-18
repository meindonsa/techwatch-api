import { Hono } from 'hono'
import { z } from 'zod'
import { createUser, getUserByEmail, verifyPassword } from '../repositories/user.repository.js'
import { signAccessToken, signRefreshToken, verifyToken } from '../services/auth.service.js'
import { 
    createRefreshToken, 
    findRefreshToken, 
    deleteRefreshToken, 
    deleteUserRefreshTokens 
} from '../repositories/refresh-token.repository.js'
import { createUserSchema, loginSchema } from "../validators/feed.validator.js";

const authRoute = new Hono()

const refreshSchema = z.object({
    refreshToken: z.string().min(1, 'Le refresh token est requis'),
})

// POST /auth/login
authRoute.post('/login', async (c) => {
    const body = await c.req.json()
    const parsed = loginSchema.safeParse(body)

    if (!parsed.success) {
        return c.json({ error: parsed.error.issues[0].message }, 400)
    }

    const user = await getUserByEmail(parsed.data.email)
    if (!user) {
        return c.json({ error: 'Identifiants invalides' }, 401)
    }

    const valid = await verifyPassword(user.password, parsed.data.password)
    if (!valid) {
        return c.json({ error: 'Identifiants invalides' }, 401)
    }

    const accessToken = await signAccessToken(user.id, user.username, user.email)
    const refreshToken = await signRefreshToken(user.id, user.username, user.email)
    
    // On stocke le refresh token en DB avec expiration
    const expiresAt = new Date()
    const expirationDays = parseInt(process.env.JWT_REFRESH_EXPIRATION?.replace('d', '') || '7')
    expiresAt.setDate(expiresAt.getDate() + expirationDays)
    
    await createRefreshToken(user.id, refreshToken, expiresAt)

    const { password: _, ...safeUser } = user

    return c.json({ 
        accessToken, 
        refreshToken, 
        user: safeUser 
    })
})

// POST /auth/refresh
authRoute.post('/refresh', async (c) => {
    const body = await c.req.json()
    const parsed = refreshSchema.safeParse(body)

    if (!parsed.success) {
        return c.json({ error: parsed.error.issues[0].message }, 400)
    }

    const token = parsed.data.refreshToken

    try {
        const payload = await verifyToken(token)
        
        if (payload.type !== 'refresh') {
            return c.json({ error: 'Token invalide' }, 401)
        }

        const storedToken = await findRefreshToken(token)
        if (!storedToken || storedToken.expires_at < new Date()) {
            return c.json({ error: 'Session expirée ou invalide' }, 401)
        }

        const newAccessToken = await signAccessToken(payload.userId, payload.username, payload.email)
        return c.json({ accessToken: newAccessToken })
    } catch (e) {
        return c.json({ error: 'Session expirée' }, 401)
    }
})

// POST /auth/logout
authRoute.post('/logout', async (c) => {
    const body = await c.req.json()
    const refreshToken = body.refreshToken

    if (refreshToken) {
        await deleteRefreshToken(refreshToken)
    }
    
    return c.json({ message: 'Déconnecté avec succès' })
})

authRoute.post('/register', async (c) => {
    const body = await c.req.json()
    const parsed = createUserSchema.safeParse(body)

    if (!parsed.success)
        return c.json({ error: parsed.error.issues[0].message }, 400)

    // Check if email already exists
    const emailExistsResult = await getUserByEmail(parsed.data.email)
    if (emailExistsResult) {
        return c.json({ error: 'Cet email est déjà utilisé' }, 409)
    }

    try {
        const user = await createUser(parsed.data.email, parsed.data.full_name, parsed.data.password)
        const { password: _, ...safeUser } = user
        return c.json(safeUser, 201)
    } catch (e: any) {
        if (e.message?.includes('UNIQUE'))
            return c.json({ error: 'Cet email est déjà utilisé' }, 409)
        return c.json({ error: 'Erreur inattendue' }, 500)
    }
})

export default authRoute