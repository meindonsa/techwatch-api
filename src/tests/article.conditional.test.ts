import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FeedError } from '../utils/errors.js'

const { mockParseURL, mockParseString, mockFetch } = vi.hoisted(() => ({
    mockParseURL: vi.fn(),
    mockParseString: vi.fn(),
    mockFetch: vi.fn(),
}))

vi.mock('rss-parser', () => ({
    default: class {
        parseURL = mockParseURL
        parseString = mockParseString
    },
}))

vi.mock('../middlewares/size-limit.middleware.js', () => ({
    fetchWithSizeLimit: mockFetch,
}))

const { getArticles, getArticlesIfModified } = await import('../services/article.service.js')

const FEED_URL = 'https://example.com/feed'

const parsedFeed = (contentSnippet = 'Un résumé court') => ({
    title: 'Mon blog',
    items: [
        { title: 'Article 1', link: 'https://example.com/1', pubDate: 'Wed, 21 Oct 2026 07:28:00 GMT', contentSnippet, creator: 'Boris' },
    ],
})

const okResponse = (headers: Record<string, string> = {}) =>
    new Response('<rss></rss>', { status: 200, headers })

beforeEach(() => {
    mockParseURL.mockReset()
    mockParseString.mockReset()
    mockFetch.mockReset()
})

afterEach(() => {
    delete process.env.SUMMARY_MAX_LENGTH
})

describe('getArticlesIfModified', () => {
    it('envoie les validateurs mémorisés en en-têtes conditionnels', async () => {
        mockFetch.mockResolvedValueOnce(okResponse())
        mockParseString.mockResolvedValueOnce(parsedFeed())

        await getArticlesIfModified(FEED_URL, {
            etag: '"abc123"',
            lastModified: 'Tue, 20 Oct 2026 10:00:00 GMT',
        })

        const [, options] = mockFetch.mock.calls[0]
        expect(options.headers['If-None-Match']).toBe('"abc123"')
        expect(options.headers['If-Modified-Since']).toBe('Tue, 20 Oct 2026 10:00:00 GMT')
    })

    it('n’envoie aucun en-tête conditionnel sans validateurs', async () => {
        mockFetch.mockResolvedValueOnce(okResponse())
        mockParseString.mockResolvedValueOnce(parsedFeed())

        await getArticlesIfModified(FEED_URL)

        const [, options] = mockFetch.mock.calls[0]
        expect(options.headers['If-None-Match']).toBeUndefined()
        expect(options.headers['If-Modified-Since']).toBeUndefined()
    })

    it('retourne notModified sur un 304 sans analyser le contenu', async () => {
        mockFetch.mockResolvedValueOnce(new Response(null, { status: 304 }))

        const result = await getArticlesIfModified(FEED_URL, { etag: '"abc123"' })

        expect(result).toEqual({ notModified: true })
        expect(mockParseString).not.toHaveBeenCalled()
    })

    it('retourne les articles et les nouveaux validateurs sur un 200', async () => {
        mockFetch.mockResolvedValueOnce(okResponse({
            etag: '"nouveau"',
            'last-modified': 'Wed, 21 Oct 2026 07:28:00 GMT',
        }))
        mockParseString.mockResolvedValueOnce(parsedFeed())

        const result = await getArticlesIfModified(FEED_URL)

        expect(result).toMatchObject({
            notModified: false,
            etag: '"nouveau"',
            lastModified: 'Wed, 21 Oct 2026 07:28:00 GMT',
        })
        if (result.notModified) throw new Error('inattendu')
        expect(result.data.title).toBe('Mon blog')
        expect(result.data.articles).toEqual([{
            title: 'Article 1',
            link: 'https://example.com/1',
            date: 'Wed, 21 Oct 2026 07:28:00 GMT',
            summary: 'Un résumé court',
            author: 'Boris',
            image: null,
        }])
    })

    it('retourne des validateurs nuls quand le serveur n’en fournit pas', async () => {
        mockFetch.mockResolvedValueOnce(okResponse())
        mockParseString.mockResolvedValueOnce(parsedFeed())

        const result = await getArticlesIfModified(FEED_URL, { etag: '"ancien"' })

        expect(result).toMatchObject({ notModified: false, etag: null, lastModified: null })
    })

    it('suit les redirections', async () => {
        mockFetch
            .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: '/nouveau-flux' } }))
            .mockResolvedValueOnce(okResponse())
        mockParseString.mockResolvedValueOnce(parsedFeed())

        await getArticlesIfModified(FEED_URL)

        expect(mockFetch).toHaveBeenCalledTimes(2)
        expect(mockFetch.mock.calls[1][0]).toBe('https://example.com/nouveau-flux')
    })

    it('refuse une redirection vers un protocole non http(s)', async () => {
        mockFetch.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'file:///etc/passwd' } }))

        await expect(getArticlesIfModified(FEED_URL)).rejects.toMatchObject({ code: 'INVALID_URL' })
        expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('abandonne après trop de redirections', async () => {
        mockFetch.mockImplementation(async () =>
            new Response(null, { status: 302, headers: { location: 'https://example.com/boucle' } }))

        await expect(getArticlesIfModified(FEED_URL)).rejects.toMatchObject({ code: 'UNREACHABLE' })
    })

    it('lance NOT_FOUND sur une réponse en erreur', async () => {
        mockFetch.mockResolvedValueOnce(new Response('introuvable', { status: 404 }))

        await expect(getArticlesIfModified(FEED_URL)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })

    it('lance TIMEOUT quand la requête est interrompue', async () => {
        mockFetch.mockRejectedValueOnce(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))

        await expect(getArticlesIfModified(FEED_URL)).rejects.toMatchObject({ code: 'TIMEOUT' })
    })

    it('lance UNREACHABLE quand le site n’existe pas', async () => {
        const error: any = new TypeError('fetch failed')
        error.cause = { code: 'ENOTFOUND' }
        mockFetch.mockRejectedValueOnce(error)

        await expect(getArticlesIfModified(FEED_URL)).rejects.toMatchObject({ code: 'UNREACHABLE' })
    })

    it('lance TOO_LARGE quand la réponse dépasse la limite', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Réponse externe trop volumineuse'))

        await expect(getArticlesIfModified(FEED_URL)).rejects.toMatchObject({ code: 'TOO_LARGE' })
    })

    it('lance PARSE_ERROR quand le contenu n’est pas un flux valide', async () => {
        mockFetch.mockResolvedValueOnce(okResponse())
        mockParseString.mockRejectedValueOnce(new Error('Feed not recognized as RSS 1 or 2.'))

        const error = await getArticlesIfModified(FEED_URL).catch((e) => e)

        expect(error).toBeInstanceOf(FeedError)
        expect(error.code).toBe('PARSE_ERROR')
    })
})

describe('troncature des résumés', () => {
    it('tronque le résumé à 300 caractères par défaut', async () => {
        mockParseURL.mockResolvedValueOnce(parsedFeed('x'.repeat(5000)))

        const { articles } = await getArticles(FEED_URL)

        expect(articles[0].summary).toHaveLength(300)
        expect(articles[0].summary!.endsWith('…')).toBe(true)
    })

    it('respecte SUMMARY_MAX_LENGTH', async () => {
        process.env.SUMMARY_MAX_LENGTH = '50'
        mockParseURL.mockResolvedValueOnce(parsedFeed('mot '.repeat(100)))

        const { articles } = await getArticles(FEED_URL)

        expect(articles[0].summary!.length).toBeLessThanOrEqual(50)
    })

    it('ignore une valeur invalide de SUMMARY_MAX_LENGTH', async () => {
        process.env.SUMMARY_MAX_LENGTH = 'beaucoup'
        mockParseURL.mockResolvedValueOnce(parsedFeed('x'.repeat(5000)))

        const { articles } = await getArticles(FEED_URL)

        expect(articles[0].summary).toHaveLength(300)
    })

    it('s’applique aussi à la lecture conditionnelle', async () => {
        mockFetch.mockResolvedValueOnce(okResponse())
        mockParseString.mockResolvedValueOnce(parsedFeed('x'.repeat(5000)))

        const result = await getArticlesIfModified(FEED_URL)

        if (result.notModified) throw new Error('inattendu')
        expect(result.data.articles[0].summary).toHaveLength(300)
    })
})
