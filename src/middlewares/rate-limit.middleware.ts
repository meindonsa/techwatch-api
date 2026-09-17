import { createMiddleware } from 'hono/factory'
import NodeCache from 'node-cache'

const cache = new NodeCache({ stdTTL: 60, checkperiod: 10 })

const DEFAULT_LIMIT = 60
const AUTH_LIMIT = 10
const AUTH_WINDOW_SECONDS = 60

const TRUSTED_PROXY = process.env.TRUSTED_PROXY === 'true'

interface RateLimitConfig {
    limit: number
    windowSeconds: number
    keyPrefix: string
}

function getClientIp(c: any): string {
    if (TRUSTED_PROXY) {
        return c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? 
               c.req.header('x-real-ip') ?? 
               'unknown'
    }
    return 'unknown'
}

function getRateLimitConfig(path: string): RateLimitConfig {
    if (path.startsWith('/auth/')) {
        return { limit: AUTH_LIMIT, windowSeconds: AUTH_WINDOW_SECONDS, keyPrefix: 'auth' }
    }
    return { limit: DEFAULT_LIMIT, windowSeconds: 60, keyPrefix: 'api' }
}

export const rateLimitMiddleware = createMiddleware(async (c, next) => {
    const path = c.req.path
    const config = getRateLimitConfig(path)
    
    const ip = getClientIp(c)
    const userId = c.get('userId')
    
    let key = `${config.keyPrefix}:${ip}`
    
    if (userId && config.keyPrefix === 'auth') {
        key = `${config.keyPrefix}:user:${userId}`
    }
    
    const current = cache.get<number>(key) ?? 0

    if (current >= config.limit) {
        return c.json(
            { error: 'Trop de requêtes, réessayez plus tard', code: 'RATE_LIMIT_EXCEEDED' },
            429
        )
    }

    cache.set(key, current + 1, config.windowSeconds)

    await next()
})