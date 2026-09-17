import { createMiddleware } from 'hono/factory'

const MAX_PAYLOAD_SIZE = 1024 * 1024
const MAX_EXTERNAL_RESPONSE_SIZE = 5 * 1024 * 1024

export const payloadSizeLimitMiddleware = createMiddleware(async (c, next) => {
    const contentLength = c.req.header('content-length')
    if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_SIZE) {
        return c.json(
            { error: 'Payload trop volumineux', code: 'PAYLOAD_TOO_LARGE' },
            413
        )
    }
    await next()
})

export async function fetchWithSizeLimit(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)
    
    const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        redirect: 'manual',
    })
    
    clearTimeout(timeoutId)
    
    const contentLength = response.headers.get('content-length')
    if (contentLength && parseInt(contentLength, 10) > MAX_EXTERNAL_RESPONSE_SIZE) {
        throw new Error('Réponse externe trop volumineuse')
    }
    
    const reader = response.body?.getReader()
    if (!reader) return response
    
    let receivedSize = 0
    const chunks: Uint8Array[] = []
    
    while (true) {
        const { done, value } = await reader.read()
        if (done) break
        
        receivedSize += value.length
        if (receivedSize > MAX_EXTERNAL_RESPONSE_SIZE) {
            reader.cancel()
            throw new Error('Réponse externe trop volumineuse')
        }
        chunks.push(value)
    }
    
    const body = new Uint8Array(receivedSize)
    let offset = 0
    for (const chunk of chunks) {
        body.set(chunk, offset)
        offset += chunk.length
    }
    
    return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
    })
}