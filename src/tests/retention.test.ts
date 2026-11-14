import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDeleteOlder, mockDeleteOverCap } = vi.hoisted(() => ({
    mockDeleteOlder: vi.fn(),
    mockDeleteOverCap: vi.fn(),
}))

vi.mock('../repositories/article.repository.js', () => ({
    deleteArticlesOlderThan: mockDeleteOlder,
    deleteArticlesOverFeedCap: mockDeleteOverCap,
}))

const {
    getRetentionConfig,
    isExpired,
    filterRetainable,
    runRetention,
} = await import('../services/retention.service.js')

const DAY_MS = 24 * 60 * 60 * 1000
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toUTCString()

beforeEach(() => {
    mockDeleteOlder.mockReset().mockResolvedValue(0)
    mockDeleteOverCap.mockReset().mockResolvedValue(0)
})

describe('getRetentionConfig', () => {
    it('applique les valeurs par défaut', () => {
        expect(getRetentionConfig({})).toEqual({
            retentionDays: 60,
            maxArticlesPerFeed: 200,
            batchSize: 1000,
            intervalMs: 6 * 60 * 60 * 1000,
        })
    })

    it('lit les variables d’environnement', () => {
        const config = getRetentionConfig({
            ARTICLE_RETENTION_DAYS: '30',
            ARTICLES_MAX_PER_FEED: '500',
            PURGE_BATCH_SIZE: '250',
            PURGE_INTERVAL_MS: '60000',
        })

        expect(config).toEqual({ retentionDays: 30, maxArticlesPerFeed: 500, batchSize: 250, intervalMs: 60000 })
    })

    it('retombe sur les valeurs par défaut quand une valeur est invalide', () => {
        const config = getRetentionConfig({
            ARTICLE_RETENTION_DAYS: 'abc',
            ARTICLES_MAX_PER_FEED: '-5',
            PURGE_BATCH_SIZE: '1.5',
        })

        expect(config.retentionDays).toBe(60)
        expect(config.maxArticlesPerFeed).toBe(200)
        expect(config.batchSize).toBe(1000)
    })

    it('ne descend jamais le plafond sous le nombre d’articles lus par scraping', () => {
        expect(getRetentionConfig({ ARTICLES_MAX_PER_FEED: '20' }).maxArticlesPerFeed).toBe(100)
    })

    it('permet de désactiver l’âge maximal et le plafond avec 0', () => {
        const config = getRetentionConfig({ ARTICLE_RETENTION_DAYS: '0', ARTICLES_MAX_PER_FEED: '0' })

        expect(config.retentionDays).toBe(0)
        expect(config.maxArticlesPerFeed).toBe(0)
    })

    it('refuse une taille de lot nulle', () => {
        expect(getRetentionConfig({ PURGE_BATCH_SIZE: '0' }).batchSize).toBe(1000)
    })
})

describe('isExpired', () => {
    it('détecte un article plus vieux que la rétention', () => {
        expect(isExpired(daysAgo(90), 60)).toBe(true)
    })

    it('garde un article récent', () => {
        expect(isExpired(daysAgo(5), 60)).toBe(false)
    })

    it('ne fait jamais expirer une date absente ou invalide', () => {
        expect(isExpired(null, 60)).toBe(false)
        expect(isExpired(undefined, 60)).toBe(false)
        expect(isExpired('pas une date', 60)).toBe(false)
    })

    it('ne fait rien quand la rétention est désactivée', () => {
        expect(isExpired(daysAgo(1000), 0)).toBe(false)
    })
})

describe('filterRetainable', () => {
    it('écarte uniquement les articles expirés', () => {
        const articles = [
            { link: 'recent', date: daysAgo(2) },
            { link: 'vieux', date: daysAgo(120) },
            { link: 'sans-date', date: null },
        ]

        expect(filterRetainable(articles, 60).map((a) => a.link)).toEqual(['recent', 'sans-date'])
    })

    it('garde tout quand la rétention est désactivée', () => {
        const articles = [{ link: 'vieux', date: daysAgo(500) }]

        expect(filterRetainable(articles, 0)).toHaveLength(1)
    })
})

describe('runRetention', () => {
    it('lance les deux purges avec la configuration donnée', async () => {
        mockDeleteOlder.mockResolvedValue(12)
        mockDeleteOverCap.mockResolvedValue(3)
        vi.spyOn(console, 'log').mockImplementation(() => {})

        const result = await runRetention({ retentionDays: 45, maxArticlesPerFeed: 150, batchSize: 500, intervalMs: 1 })

        expect(mockDeleteOlder).toHaveBeenCalledWith(45, 500)
        expect(mockDeleteOverCap).toHaveBeenCalledWith(150, 500)
        expect(result).toEqual({ expired: 12, overCap: 3 })
    })

    it('saute les purges désactivées', async () => {
        const result = await runRetention({ retentionDays: 0, maxArticlesPerFeed: 0, batchSize: 500, intervalMs: 1 })

        expect(mockDeleteOlder).not.toHaveBeenCalled()
        expect(mockDeleteOverCap).not.toHaveBeenCalled()
        expect(result).toEqual({ expired: 0, overCap: 0 })
    })
})

describe('runRetentionIfDue', () => {
    beforeEach(() => {
        vi.resetModules()
    })

    it('ne purge qu’une fois par intervalle', async () => {
        const { runRetentionIfDue } = await import('../services/retention.service.js')
        const interval = getRetentionConfig().intervalMs
        const start = Date.now()

        expect(await runRetentionIfDue(start)).toBe(true)
        expect(await runRetentionIfDue(start + interval - 1)).toBe(false)
        expect(await runRetentionIfDue(start + interval)).toBe(true)
    })
})
