import { getAllFeeds } from '../repositories/feed.repository.js'
import { insertArticles } from '../repositories/article.repository.js'
import { getArticles } from './article.service.js'
import { notifyUpdatedFeeds } from './ws.service.js'
import { FeedError } from '../utils/errors.js'
import { cleanupExpiredTokens } from '../repositories/refresh-token.repository.js'

const CRON_INTERVAL =Number(process.env.CRON_INTERVAL_MS ?? 15 * 60 * 1000)

/**
 * Scrappe tous les feeds en DB et insère les nouveaux articles.
 * Retourne la liste des feedId ayant eu de nouveaux articles.
 */
export async function scrapeAllFeeds(): Promise<number[]> {
    const feeds = await getAllFeeds()
    const updatedFeedIds: number[] = []

    await Promise.allSettled(
        feeds.map(async (feed) => {
            try {
                const feedData = await getArticles(feed.feed_url)

                const inserted = await insertArticles(
                    feedData.articles.map((a) => ({
                        feed_id: feed.id,
                        title: a.title,
                        link: a.link,
                        pub_date: a.date,
                        summary: a.summary,
                        author: a.author,
                        image: a.image,
                    }))
                )

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
    }, CRON_INTERVAL)
}

export function stopCron(): void {
    if (cronHandle) {
        clearInterval(cronHandle)
        cronHandle = null
        console.log('[cron] Arrêté')
    }
}