import { describe, it, expect, vi, beforeEach } from 'vitest'
import {detectSource} from "../services/detection.service.js";

// Mock du fetch global
const mockFetch = vi.fn()
global.fetch = mockFetch

function createMockResponse(text: string, ok: boolean = true) {
    const encoder = new TextEncoder()
    const data = encoder.encode(text)
    return {
        ok,
        status: ok ? 200 : 404,
        statusText: ok ? 'OK' : 'Not Found',
        headers: new Headers({ 'content-length': data.length.toString() }),
        body: {
            getReader: () => ({
                read: vi.fn()
                    .mockResolvedValueOnce({ done: false, value: data })
                    .mockResolvedValue({ done: true, value: undefined }),
                cancel: vi.fn(),
            }),
        },
        text: async () => text,
    } as unknown as Response
}

beforeEach(() => {
    mockFetch.mockReset()
})

describe('detectSource', () => {
    it('détecte un flux via balise <link> dans le HTML', async () => {
        mockFetch.mockResolvedValueOnce(createMockResponse(`
        <html>
          <head>
            <link rel="alternate" type="application/rss+xml" href="/feed" />
          </head>
        </html>
      `))

        // Mock pour la validation du flux trouvé
        mockFetch.mockResolvedValueOnce(createMockResponse('', true))

        const result = await detectSource('dev.to')
        expect(result.type).not.toBe('none')
        expect(result.feedUrl).toContain('/feed')
    })

    it('retourne none si aucun flux trouvé', async () => {
        mockFetch.mockResolvedValue(createMockResponse('<html><head></head></html>'))

        const result = await detectSource('site-sans-rss.com')
        expect(result.type).toBe('none')
        expect(result.feedUrl).toBeNull()
    })

    it('normalise une URL sans protocole', async () => {
        mockFetch.mockResolvedValue(createMockResponse('<html><head></head></html>'))

        const result = await detectSource('dev.to')
        expect(result.originalUrl).toBe('https://dev.to')
    })

    it('gère une erreur réseau gracieusement', async () => {
        mockFetch.mockRejectedValue(new Error('Network error'))

        const result = await detectSource('site-inaccessible.com')
        expect(result.type).toBe('none')
    })
})