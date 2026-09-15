import { db } from '../db/index.js'
import type { Feed } from './feed.repository.js'

export interface UserFeed {
    id: number
    user_id: number
    feed_id: number
    created_at: Date
}

export async function subscribeUserToFeed(userId: number, feedId: number): Promise<UserFeed> {
    const result = await db.query(`
    INSERT INTO user_feeds (user_id, feed_id)
    VALUES ($1, $2)
    ON CONFLICT(user_id, feed_id) DO NOTHING
    RETURNING *
  `, [userId, feedId])
    
    if (result.rows[0]) return result.rows[0] as UserFeed

    const existing = await db.query(`
    SELECT * FROM user_feeds WHERE user_id = $1 AND feed_id = $2
  `, [userId, feedId])
    return existing.rows[0] as UserFeed
}

export async function unsubscribeUserFromFeed(userId: number, feedId: number): Promise<void> {
    await db.query(`DELETE FROM user_feeds WHERE user_id = $1 AND feed_id = $2`, [userId, feedId])
}

export async function getFeedsByUser(userId: number): Promise<Feed[]> {
    const result = await db.query(`
    SELECT f.*, COUNT(a.id) as article_count 
    FROM feeds f
    INNER JOIN user_feeds uf ON uf.feed_id = f.id
    LEFT JOIN articles a ON a.feed_id = f.id
    WHERE uf.user_id = $1
    GROUP BY f.id, uf.created_at
    ORDER BY uf.created_at DESC
  `, [userId])
    return result.rows as Feed[]
}

export async function getUserIdsByFeed(feedId: number): Promise<number[]> {
    const result = await db.query(`
    SELECT user_id FROM user_feeds WHERE feed_id = $1
  `, [feedId])
    return result.rows.map(r => r.user_id)
}
