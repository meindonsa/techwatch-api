import { createMiddleware } from 'hono/factory'

export const securityHeadersMiddleware = createMiddleware(async (c, next) => {
    await next()
    
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('X-Frame-Options', 'DENY')
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
    c.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
    
    if (process.env.NODE_ENV === 'production') {
        c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload')
    }
    
    c.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'")
})