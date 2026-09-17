import { createMiddleware } from 'hono/factory'
import dns from 'node:dns/promises'

const BLOCKED_HOSTNAMES = ['localhost', '0.0.0.0']

const BLOCKED_IP_RANGES: Array<{ start: bigint; end: bigint }> = [
    { start: ipToBigInt('10.0.0.0'), end: ipToBigInt('10.255.255.255') },
    { start: ipToBigInt('172.16.0.0'), end: ipToBigInt('172.31.255.255') },
    { start: ipToBigInt('192.168.0.0'), end: ipToBigInt('192.168.255.255') },
    { start: ipToBigInt('127.0.0.0'), end: ipToBigInt('127.255.255.255') },
    { start: ipToBigInt('169.254.0.0'), end: ipToBigInt('169.254.255.255') },
    { start: ipToBigInt('100.64.0.0'), end: ipToBigInt('100.127.255.255') },
    { start: ipToBigInt('::1'), end: ipToBigInt('::1') },
    { start: ipToBigInt('fc00::'), end: ipToBigInt('fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff') },
    { start: ipToBigInt('fe80::'), end: ipToBigInt('febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff') },
]

function ipToBigInt(ip: string): bigint {
    if (ip.includes(':')) {
        const parts = ip.split(':').map(p => BigInt(`0x${p || '0'}`))
        let result = BigInt(0)
        for (const part of parts) {
            result = (result << 16n) | part
        }
        return result
    }
    return ip.split('.').reduce((acc, octet) => (acc << 8n) | BigInt(octet), BigInt(0))
}

function isPrivateIp(ip: string): boolean {
    try {
        const ipNum = ipToBigInt(ip)
        return BLOCKED_IP_RANGES.some(range => ipNum >= range.start && ipNum <= range.end)
    } catch {
        return false
    }
}

async function resolveHostname(hostname: string): Promise<string[]> {
    try {
        const records = await dns.resolve4(hostname)
        return records
    } catch {
        try {
            const records = await dns.resolve6(hostname)
            return records
        } catch {
            return []
        }
    }
}

function normalizeHostname(hostname: string): string {
    return hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
}

function isBlockedHostname(hostname: string): boolean {
    const normalized = normalizeHostname(hostname)
    return BLOCKED_HOSTNAMES.includes(normalized)
}

async function isUrlAllowed(urlString: string): Promise<boolean> {
    try {
        const url = urlString.startsWith('http') ? urlString : `https://${urlString}`
        const parsed = new URL(url)
        
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return false
        }
        
        const hostname = parsed.hostname
        
        if (isBlockedHostname(hostname)) {
            return false
        }
        
        if (isPrivateIp(hostname)) {
            return false
        }
        
        const resolvedIps = await resolveHostname(hostname)
        for (const ip of resolvedIps) {
            if (isPrivateIp(ip)) {
                return false
            }
        }
        
        return true
    } catch {
        return false
    }
}

export const ssrfMiddleware = createMiddleware(async (c, next) => {
    try {
        const body = await c.req.json()

        const urls: string[] = Array.isArray(body) ? body : [body]

        for (const url of urls) {
            if (typeof url === 'string') {
                const allowed = await isUrlAllowed(url)
                if (!allowed) {
                    return c.json(
                        { error: 'URL non autorisée', code: 'BLOCKED_URL' },
                        403
                    )
                }
            }
        }
    } catch {
    }

    await next()
})