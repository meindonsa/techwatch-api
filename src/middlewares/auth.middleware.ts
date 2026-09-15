import { createMiddleware } from 'hono/factory'
import {verifyToken} from "../services/auth.service.js";

export const authMiddleware = createMiddleware(async (c, next) => {
    const authHeader = c.req.header('Authorization')
    const authAppHeader = c.req.header('X-App-Token')

    if (!authAppHeader || !authAppHeader.startsWith('cs ')) {
        return c.json({ error: 'Access denied' }, 403)
    }

    const apiToken = authAppHeader?.split(' ')[1];
    if (apiToken !== process.env.API_SECRET_TOKEN) {
        return c.json({ error: 'Access denied' }, 401)
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return c.json({ error: 'Invalid token' }, 403)
    }

    const token = authHeader.split(' ')[1]

    try {
        const payload = await verifyToken(token)
        
        if (payload.type !== 'access') {
            return c.json({ error: 'Token invalide' }, 401)
        }

        c.set('userId', payload.userId)
        c.set('username', payload.username)
        await next()
    } catch {
        return c.json({ error: 'Token invalide ou expiré' }, 401)
    }
})