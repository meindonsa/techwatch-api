import { getFeedsToScrape, updateFeedCacheHeaders } from '../repositories/feed.repository.js'
import { insertArticles } from '../repositories/article.repository.js'
import { getArticlesIfModified } from './article.service.js'
import { notifyUpdatedFeeds } from './ws.service.js'
import { FeedError } from '../utils/errors.js'
import { cleanupExpiredTokens } from '../repositories/refresh-token.repository.js'
import { filterRetainable, runRetentionIfDue } from './retention.service.js'

const CRON_INTERVAL =Number(process.env.CRON_INTERVAL_MS ?? 15 * 60 * 1000)

/**
 * Scrappe les feeds suivis par au moins un utilisateur et insère les nouveaux articles.
 * Les requêtes sont conditionnelles (ETag / Last-Modified) : un flux inchangé n'est ni téléchargé ni analysé.
 * Retourne la liste des feedId ayant eu de nouveaux articles.
 */
export async function scrapeAllFeeds(): Promise<number[]> {
    const feeds = await getFeedsToScrape()
    const updatedFeedIds: number[] = []

    await Promise.allSettled(
        feeds.map(async (feed) => {
            try {
                const result = await getArticlesIfModified(feed.feed_url, {
                    etag: feed.etag,
                    lastModified: feed.last_modified,
                })

                if (result.notModified) return

                const inserted = await insertArticles(
                    filterRetainable(result.data.articles).map((a) => ({
                        feed_id: feed.id,
                        title: a.title,
                        link: a.link,
                        pub_date: a.date,
                        summary: a.summary,
                        author: a.author,
                        image: a.image,
                    }))
                )

                // Mémorisé seulement après l'insertion : en cas d'échec, le flux sera retéléchargé au prochain passage
                if (result.etag !== feed.etag || result.lastModified !== feed.last_modified) {
                    await updateFeedCacheHeaders(feed.id, result.etag, result.lastModified)
                }

                if (inserted > 0) {
                    updatedFeedIds.push(feed.id)
                    console.log(`[cron] Feed #${feed.id} (${feed.name}) — ${inserted} nouvel(s) article(s)`)
                }
            } catch (e) {
                if (e instanceof FeedError) {
                    console.warn(`[cron] Feed #${feed.id} ignoré : ${e.message}`)
                } else {
                    console.error(`[cron] Erreur inattendue sur le feed #${feed.id}`, e)
                }
            }
        })
    )

    return updatedFeedIds
}

let cronHandle: ReturnType<typeof setInterval> | null = null

export function startCron(): void {
    if (cronHandle) return;

    console.log(`[cron] Démarrage — intervalle : ${CRON_INTERVAL / 1000}s`)

    scrapeAllFeeds()

    cronHandle = setInterval(async () => {
        const updatedFeedIds = await scrapeAllFeeds()
        await notifyUpdatedFeeds(updatedFeedIds)
        await cleanupExpiredTokens()

        try {
            await runRetentionIfDue()
        } catch (e) {
            console.error('[retention] Échec de la purge', e)
        }
    }, CRON_INTERVAL)
}

export function stopCron(): void {
    if (cronHandle) {
        clearInterval(cronHandle)
        cronHandle = null
        console.log('[cron] Arrêté')
    }
}
