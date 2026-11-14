import { db } from '../db/index.js'

export interface Article {
    id: number
    title: string
    link: string
    pub_date: Date | null
    summary: string | null
    author: string | null
    image: string | null
    feed_id: number
    fetched_at: Date
    source_name?: string
}

export interface NewArticle {
    title: string
    link: string
    pub_date?: string | null
    summary?: string | null
    author?: string | null
    image?: string | null
    feed_id: number
}

/**
 * Insère les articles en ignorant les doublons (UNIQUE sur link).
 * Retourne le nombre de nouvelles lignes insérées.
 */
export async function insertArticles(articles: NewArticle[]): Promise<number> {
    if (articles.length === 0) return 0

    const client = await db.connect()
    try {
        await client.query('BEGIN')
        let inserted = 0
        for (const item of articles) {
            const result = await client.query(`
                INSERT INTO articles (title, link, pub_date, summary, author, image, feed_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT(link) DO NOTHING
            `, [item.title, item.link, item.pub_date, item.summary, item.author, item.image, item.feed_id])
            inserted += result.rowCount ?? 0
        }
        await client.query('COMMIT')
        return inserted
    } catch (e) {
        await client.query('ROLLBACK')
        throw e
    } finally {
        client.release()
    }
}

/**
 * Supprime, par lots, les articles dont la date de publication dépasse `days` jours.
 * Les articles sans date de publication ne sont jamais purgés par l'âge (ils restent soumis au plafond par flux).
 * Les lots courts évitent de verrouiller la table longtemps. Retourne le nombre de lignes supprimées.
 */
export async function deleteArticlesOlderThan(days: number, batchSize: number): Promise<number> {
    let total = 0

    while (true) {
        const result = await db.query(`
            DELETE FROM articles
            WHERE id IN (
                SELECT id FROM articles
                WHERE pub_date IS NOT NULL
                  AND pub_date < NOW() - make_interval(days => $1::int)
                LIMIT $2
            )
        `, [days, batchSize])

        const deleted = result.rowCount ?? 0
        total += deleted
        if (deleted < batchSize) return total
    }
}

/**
 * Ne garde que les `maxPerFeed` articles les plus récents de chaque flux (par lots).
 * Le rang se base sur la date de publication, à défaut sur la date de récupération.
 * Retourne le nombre de lignes supprimées.
 */
export async function deleteArticlesOverFeedCap(maxPerFeed: number, batchSize: number): Promise<number> {
    let total = 0

    while (true) {
        const result = await db.query(`
            DELETE FROM articles
            WHERE id IN (
                SELECT id FROM (
                    SELECT a.id,
                           ROW_NUMBER() OVER (
                               PARTITION BY a.feed_id
                               ORDER BY COALESCE(a.pub_date, a.fetched_at) DESC, a.id DESC
                           ) AS rn
                    FROM articles a
                    WHERE a.feed_id IN (
                        SELECT feed_id FROM articles GROUP BY feed_id HAVING COUNT(*) > $1::int
                    )
                ) ranked
                WHERE rn > $1::int
                LIMIT $2
            )
        `, [maxPerFeed, batchSize])

        const deleted = result.rowCount ?? 0
        total += deleted
        if (deleted < batchSize) return total
    }
}

export async function getArticleById(id: number): Promise<Article | undefined> {
    const result = await db.query(`
        SELECT a.*, f.name as source_name 
        FROM articles a 
        JOIN feeds f ON a.feed_id = f.id 
        WHERE a.id = $1
    `, [id])
    return result.rows[0] as Article | undefined
}

export async function getArticlesByFeed(feedId: number, limit = 50): Promise<Article[]> {
    const result = await db.query(`
        SELECT a.*, f.name as source_name 
        FROM articles a 
        JOIN feeds f ON a.feed_id = f.id 
        WHERE a.feed_id = $1
        ORDER BY a.pub_date DESC
        LIMIT $2
    `, [feedId, limit])
    return result.rows as Article[]
}

export async function getArticlesByUser(userId: number, limit = 100, offset = 0, searchKey: string | null = null): Promise<Article[]> {
    const result = await db.query(`
        SELECT a.*, f.name as source_name 
        FROM articles a 
        JOIN feeds f ON a.feed_id = f.id
        INNER JOIN user_feeds uf ON uf.feed_id = a.feed_id
        WHERE uf.user_id = $1 ${searchKey ? 'AND (a.title ILIKE $2 OR a.summary ILIKE $2)' : ''}
        ORDER BY a.pub_date DESC
        LIMIT $${searchKey ? 3 : 2} OFFSET $${searchKey ? 4 : 3}
    `, searchKey ? [userId, `%${searchKey}%`, limit, offset] : [userId, limit, offset])
    return result.rows as Article[]
}

export async function countArticlesByUser(userId: number, searchKey: string | null = null): Promise<number> {
    const result = await db.query(`
        SELECT COUNT(*) 
        FROM articles a 
        INNER JOIN user_feeds uf ON uf.feed_id = a.feed_id
        WHERE uf.user_id = $1 ${searchKey ? 'AND (a.title ILIKE $2 OR a.summary ILIKE $2)' : ''}
    `, searchKey ? [userId, `%${searchKey}%`] : [userId])
    return parseInt(result.rows[0].count)
}

export async function getArticlesByUserAndFeed(userId: number, feedId: number, limit = 100, offset = 0, searchKey: string | null = null): Promise<Article[]> {
    const result = await db.query(`
        SELECT a.*, f.name as source_name 
        FROM articles a 
        JOIN feeds f ON a.feed_id = f.id
        INNER JOIN user_feeds uf ON uf.feed_id = a.feed_id
        WHERE uf.user_id = $1 AND uf.feed_id = $2 ${searchKey ? 'AND (a.title ILIKE $3 OR a.summary ILIKE $3)' : ''}
        ORDER BY a.pub_date DESC
        LIMIT $${searchKey ? 4 : 3} OFFSET $${searchKey ? 5 : 4}
    `, searchKey ? [userId, feedId, `%${searchKey}%`, limit, offset] : [userId, feedId, limit, offset])
    return result.rows as Article[]
}

export async function countArticlesByUserAndFeed(userId: number, feedId: number, searchKey: string | null = null): Promise<number> {
    const result = await db.query(`
        SELECT COUNT(*) 
        FROM articles a 
        INNER JOIN user_feeds uf ON uf.feed_id = a.feed_id
        WHERE uf.user_id = $1 AND uf.feed_id = $2 ${searchKey ? 'AND (a.title ILIKE $3 OR a.summary ILIKE $3)' : ''}
    `, searchKey ? [userId, feedId, `%${searchKey}%`] : [userId, feedId])
    return parseInt(result.rows[0].count)
}
