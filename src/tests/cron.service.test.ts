import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FeedError } from '../utils/errors.js'

const mocks = vi.hoisted(() => ({
    getFeedsToScrape: vi.fn(),
    updateFeedCacheHeaders: vi.fn(),
    insertArticles: vi.fn(),
    getArticlesIfModified: vi.fn(),
    notifyUpdatedFeeds: vi.fn(),
    cleanupExpiredTokens: vi.fn(),
}))

vi.mock('../repositories/feed.repository.js', () => ({
    getFeedsToScrape: mocks.getFeedsToScrape,
    updateFeedCacheHeaders: mocks.updateFeedCacheHeaders,
}))

vi.mock('../repositories/article.repository.js', () => ({
    insertArticles: mocks.insertArticles,
    deleteArticlesOlderThan: vi.fn(),
    deleteArticlesOverFeedCap: vi.fn(),
}))

vi.mock('../services/article.service.js', () => ({
    getArticlesIfModified: mocks.getArticlesIfModified,
    MAX_ARTICLES_PER_FEED: 100,
}))

vi.mock('../services/ws.service.js', () => ({
    notifyUpdatedFeeds: mocks.notifyUpdatedFeeds,
}))

vi.mock('../repositories/refresh-token.repository.js', () => ({
    cleanupExpiredTokens: mocks.cleanupExpiredTokens,
}))

const { scrapeAllFeeds } = await import('../services/cron.service.js')

const DAY_MS = 24 * 60 * 60 * 1000
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toUTCString()

const feed = (id: number, etag: string | null = null, lastModified: string | null = null) => ({
    id,
    type: 'rss' as const,
    feed_url: `https://example.com/${id}/feed`,
    original_url: `https://example.com/${id}`,
    name: `Feed ${id}`,
    created_at: new Date(),
    etag,
    last_modified: lastModified,
})

const article = (link: string, date: string | null) => ({
    title: link, link, date, summary: null, author: null, image: null,
})

const modified = (articles: ReturnType<typeof article>[], etag: string | null, lastModified: string | null = null) => ({
    notModified: false as const,
    data: { feedUrl: 'x', title: 'x', articles },
    etag,
    lastModified,
})

beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset())
    mocks.insertArticles.mockResolvedValue(0)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('scrapeAllFeeds', () => {
    it('transmet les validateurs mémorisés du flux', async () => {
        mocks.getFeedsToScrape.mockResolvedValue([feed(1, '"abc"', 'Tue, 20 Oct 2026 10:00:00 GMT')])
        mocks.getArticlesIfModified.mockResolvedValue({ notModified: true })

        await scrapeAllFeeds()

        expect(mocks.getArticlesIfModified).toHaveBeenCalledWith('https://example.com/1/feed', {
            etag: '"abc"',
            lastModified: 'Tue, 20 Oct 2026 10:00:00 GMT',
        })
    })

    it('ignore un flux inchangé (304) : aucune insertion ni écriture', async () => {
        mocks.getFeedsToScrape.mockResolvedValue([feed(1, '"abc"')])
        mocks.getArticlesIfModified.mockResolvedValue({ notModified: true })

        const updated = await scrapeAllFeeds()

        expect(updated).toEqual([])
        expect(mocks.insertArticles).not.toHaveBeenCalled()
        expect(mocks.updateFeedCacheHeaders).not.toHaveBeenCalled()
    })

    it('insère les nouveaux articles, mémorise les validateurs et signale le flux', async () => {
        mocks.getFeedsToScrape.mockResolvedValue([feed(7)])
        mocks.getArticlesIfModified.mockResolvedValue(
            modified([article('https://example.com/a', daysAgo(1))], '"v2"', 'Wed, 21 Oct 2026 07:28:00 GMT')
        )
        mocks.insertArticles.mockResolvedValue(1)

        const updated = await scrapeAllFeeds()

        expect(updated).toEqual([7])
        expect(mocks.insertArticles).toHaveBeenCalledWith([
            expect.objectContaining({ feed_id: 7, link: 'https://example.com/a' }),
        ])
        expect(mocks.updateFeedCacheHeaders).toHaveBeenCalledWith(7, '"v2"', 'Wed, 21 Oct 2026 07:28:00 GMT')
    })

    it('n’écrit pas les validateurs quand ils n’ont pas changé', async () => {
        mocks.getFeedsToScrape.mockResolvedValue([feed(3, '"v1"', null)])
        mocks.getArticlesIfModified.mockResolvedValue(modified([article('https://example.com/a', daysAgo(1))], '"v1"', null))

        await scrapeAllFeeds()

        expect(mocks.updateFeedCacheHeaders).not.toHaveBeenCalled()
    })

    it('n’insère pas les articles plus vieux que la rétention', async () => {
        mocks.getFeedsToScrape.mockResolvedValue([feed(1)])
        mocks.getArticlesIfModified.mockResolvedValue(modified([
            article('https://example.com/recent', daysAgo(3)),
            article('https://example.com/vieux', daysAgo(400)),
            article('https://example.com/sans-date', null),
        ], '"v1"'))

        await scrapeAllFeeds()

        const inserted = mocks.insertArticles.mock.calls[0][0].map((a: { link: string }) => a.link)
        expect(inserted).toEqual(['https://example.com/recent', 'https://example.com/sans-date'])
    })

    it('ne mémorise pas les validateurs si l’insertion échoue', async () => {
        mocks.getFeedsToScrape.mockResolvedValue([feed(1)])
        mocks.getArticlesIfModified.mockResolvedValue(modified([article('https://example.com/a', daysAgo(1))], '"v1"'))
        mocks.insertArticles.mockRejectedValue(new Error('db down'))

        const updated = await scrapeAllFeeds()

        expect(updated).toEqual([])
        expect(mocks.updateFeedCacheHeaders).not.toHaveBeenCalled()
    })

    it('continue avec les autres flux quand l’un échoue', async () => {
        mocks.getFeedsToScrape.mockResolvedValue([feed(1), feed(2)])
        mocks.getArticlesIfModified
            .mockRejectedValueOnce(new FeedError('TIMEOUT', 'Le site a mis trop de temps à répondre'))
            .mockResolvedValueOnce(modified([article('https://example.com/b', daysAgo(1))], null))
        mocks.insertArticles.mockResolvedValue(1)

        const updated = await scrapeAllFeeds()

        expect(updated).toEqual([2])
    })
})
