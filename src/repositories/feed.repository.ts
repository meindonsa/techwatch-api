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

export interface NewFeed {
    type: 'rss' | 'atom'
    feed_url: string
    original_url: string
    name: string
}

export async function upsertFeed(data: NewFeed): Promise<Feed> {
    await db.query(`
        INSERT INTO feeds (type, feed_url, original_url, name)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT(feed_url) DO UPDATE SET
                                            name         = COALESCE(EXCLUDED.name, feeds.name),
                                            original_url = EXCLUDED.original_url,
                                            type         = EXCLUDED.type
    `, [data.type, data.feed_url, data.original_url, data.name])

    const result = await db.query(`SELECT * FROM feeds WHERE feed_url = $1`, [data.feed_url])
    return result.rows[0] as Feed
}

export async function getFeedById(id: number): Promise<Feed | undefined> {
    const result = await db.query(`SELECT * FROM feeds WHERE id = $1`, [id])
    return result.rows[0] as Feed | undefined
}

export async function updateFeedName(id: number, name: string): Promise<Feed> {
    await db.query(`UPDATE feeds SET name = $1 WHERE id = $2`, [name, id])
    const result = await db.query(`SELECT * FROM feeds WHERE id = $1`, [id])
    return result.rows[0] as Feed
}

export async function deleteFeed(id: number): Promise<void> {
    await db.query(`DELETE FROM feeds WHERE id = $1`, [id])
}

export async function getAllFeeds(): Promise<Feed[]> {
    const result = await db.query(`SELECT * FROM feeds`)
    return result.rows as Feed[]
}

export async function getFeedsWithCounts(): Promise<Feed[]> {
    const result = await db.query(`
        SELECT f.*, COUNT(a.id) as article_count 
        FROM feeds f 
        LEFT JOIN articles a ON f.id = a.feed_id 
        GROUP BY f.id
    `)
    return result.rows as Feed[]
}
