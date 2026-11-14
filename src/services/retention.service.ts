import { deleteArticlesOlderThan, deleteArticlesOverFeedCap } from '../repositories/article.repository.js'
import { MAX_ARTICLES_PER_FEED } from './article.service.js'

const DAY_MS = 24 * 60 * 60 * 1000

export interface RetentionConfig {
    /** Âge maximal des articles, en jours (0 = pas de purge par l'âge). */
    retentionDays: number
    /** Nombre maximal d'articles conservés par flux (0 = pas de plafond). */
    maxArticlesPerFeed: number
    /** Taille des lots de suppression. */
    batchSize: number
    /** Délai minimal entre deux purges, en millisecondes. */
    intervalMs: number
}

function readInt(raw: string | undefined, fallback: number): number {
    if (raw === undefined || raw.trim() === '') return fallback
    const value = Number(raw)
    return Number.isInteger(value) && value >= 0 ? value : fallback
}

/**
 * Lit la configuration depuis l'environnement :
 * ARTICLE_RETENTION_DAYS (60), ARTICLES_MAX_PER_FEED (200), PURGE_BATCH_SIZE (1000), PURGE_INTERVAL_MS (6 h).
 *
 * Le plafond par flux n'est jamais inférieur au nombre d'articles lus à chaque scraping :
 * sinon des articles purgés seraient réinsérés puis re-notifiés à chaque passage.
 */
export function getRetentionConfig(env: NodeJS.ProcessEnv = process.env): RetentionConfig {
    const cap = readInt(env.ARTICLES_MAX_PER_FEED, 200)
    const batchSize = readInt(env.PURGE_BATCH_SIZE, 1000)

    return {
        retentionDays: readInt(env.ARTICLE_RETENTION_DAYS, 60),
        maxArticlesPerFeed: cap === 0 ? 0 : Math.max(cap, MAX_ARTICLES_PER_FEED),
        batchSize: batchSize === 0 ? 1000 : batchSize,
        intervalMs: readInt(env.PURGE_INTERVAL_MS, 6 * 60 * 60 * 1000),
    }
}

/** Vrai si la date de publication dépasse la durée de rétention (une date absente ou invalide n'expire jamais). */
export function isExpired(date: string | Date | null | undefined, retentionDays: number, now: number = Date.now()): boolean {
    if (retentionDays <= 0 || !date) return false

    const time = new Date(date).getTime()
    if (Number.isNaN(time)) return false

    return time < now - retentionDays * DAY_MS
}

/**
 * Écarte les articles déjà plus vieux que la durée de rétention avant insertion :
 * sans cela, la purge les supprimerait puis le scraping les réinsérerait (et les notifierait) en boucle.
 */
export function filterRetainable<T extends { date: string | null }>(
    articles: T[],
    retentionDays: number = getRetentionConfig().retentionDays
): T[] {
    return articles.filter((article) => !isExpired(article.date, retentionDays))
}

export async function runRetention(config: RetentionConfig = getRetentionConfig()): Promise<{ expired: number; overCap: number }> {
    const expired = config.retentionDays > 0
        ? await deleteArticlesOlderThan(config.retentionDays, config.batchSize)
        : 0

    const overCap = config.maxArticlesPerFeed > 0
        ? await deleteArticlesOverFeedCap(config.maxArticlesPerFeed, config.batchSize)
        : 0

    if (expired + overCap > 0) {
        console.log(`[retention] ${expired} article(s) expiré(s), ${overCap} au-delà du plafond par flux`)
    }

    return { expired, overCap }
}

let lastRunAt = 0

/**
 * Lance la purge si le délai minimal est écoulé depuis la précédente.
 * Le cron s'exécute toutes les 15 minutes : la purge n'a pas besoin de suivre ce rythme.
 */
export async function runRetentionIfDue(now: number = Date.now()): Promise<boolean> {
    const config = getRetentionConfig()
    if (now - lastRunAt < config.intervalMs) return false

    lastRunAt = now
    await runRetention(config)
    return true
}
