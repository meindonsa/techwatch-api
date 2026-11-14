import { db } from '../db/index.js'

export interface Feed {
    id: number
    type: 'rss' | 'atom'
    feed_url: string
    original_url: string
    name: string
    created_at: Date
    article_count?: number
}

/** Flux à scraper, avec les validateurs HTTP du dernier téléchargement. */
export interface FeedToScrape extends Feed {
    etag: string | null
    last_modified: string | null
}

export interface NewFeed {
    type: 'rss' | 'atom'
    feed_url: string
    original_url: string
    name: string
}

/**
 * Colonnes exposées par l'API : les validateurs HTTP (etag, last_modified)
 * sont purement internes et ne doivent pas apparaître dans les réponses.
 */
export const FEED_COLUMNS = 'id, type, feed_url, original_url, name, created_at'
export const FEED_COLUMNS_ALIASED = 'f.id, f.type, f.feed_url, f.original_url, f.name, f.created_at'

export async function upsertFeed(data: NewFeed): Promise<Feed> {
    await db.query(`
        INSERT INTO feeds (type, feed_url, original_url, name)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT(feed_url) DO UPDATE SET
                                            name         = COALESCE(EXCLUDED.name, feeds.name),
                                            original_url = EXCLUDED.original_url,
                                            type         = EXCLUDED.type
    `, [data.type, data.feed_url, data.original_url, data.name])

    const result = await db.query(`SELECT ${FEED_COLUMNS} FROM feeds WHERE feed_url = $1`, [data.feed_url])
    return result.rows[0] as Feed
}

export async function getFeedById(id: number): Promise<Feed | undefined> {
    const result = await db.query(`SELECT ${FEED_COLUMNS} FROM feeds WHERE id = $1`, [id])
    return result.rows[0] as Feed | undefined
}

export async function updateFeedName(id: number, name: string): Promise<Feed> {
    await db.query(`UPDATE feeds SET name = $1 WHERE id = $2`, [name, id])
    const result = await db.query(`SELECT ${FEED_COLUMNS} FROM feeds WHERE id = $1`, [id])
    return result.rows[0] as Feed
}

export async function deleteFeed(id: number): Promise<void> {
    await db.query(`DELETE FROM feeds WHERE id = $1`, [id])
}

export async function getAllFeeds(): Promise<Feed[]> {
    const result = await db.query(`SELECT ${FEED_COLUMNS} FROM feeds`)
    return result.rows as Feed[]
}

/**
 * Flux à scraper : uniquement ceux qui ont au moins un abonné.
 * Un flux sans abonné n'est plus téléchargé (ses articles restent soumis à la purge).
 */
export async function getFeedsToScrape(): Promise<FeedToScrape[]> {
    const result = await db.query(`
        SELECT ${FEED_COLUMNS_ALIASED}, f.etag, f.last_modified
        FROM feeds f
        WHERE EXISTS (SELECT 1 FROM user_feeds uf WHERE uf.feed_id = f.id)
    `)
    return result.rows as FeedToScrape[]
}

/** Mémorise les validateurs HTTP renvoyés par le serveur lors du dernier téléchargement. */
export async function updateFeedCacheHeaders(id: number, etag: string | null, lastModified: string | null): Promise<void> {
    await db.query(
        `UPDATE feeds SET etag = $1, last_modified = $2 WHERE id = $3`,
        [etag, lastModified, id]
    )
}

export async function getFeedsWithCounts(): Promise<Feed[]> {
    const result = await db.query(`
        SELECT ${FEED_COLUMNS_ALIASED}, COUNT(a.id) as article_count
        FROM feeds f
        LEFT JOIN articles a ON f.id = a.feed_id
        GROUP BY f.id
    `)
    return result.rows as Feed[]
}
