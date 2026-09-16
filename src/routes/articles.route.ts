import { Hono } from 'hono'
import {getArticles} from "../services/article.service.js";
import {urlArraySchema, urlSchema} from "../validators/feed.validator.js";
import {FeedError} from "../utils/errors.js";
import {getUserByUsername} from "../repositories/user.repository.js";
import {getArticlesByUser, getArticlesByUserAndFeed, getArticleById, countArticlesByUser, countArticlesByUserAndFeed} from "../repositories/article.repository.js";
import articleRoute from "./article.route.js";

const articlesRoute = new Hono()

articlesRoute.post('/', async (c) => {
    const body = await c.req.json()
    const parsed = urlArraySchema.safeParse(body)

    if (!parsed.success)
        return c.json({ error: parsed.error.issues[0].message }, 400)

    const results = await Promise.allSettled(parsed.data.map(getArticles))

    const success = []
    const failed = []

    for (let i = 0; i < results.length; i++) {
        const result = results[i]
        if (result.status === 'fulfilled') {
            success.push(result.value)
        } else {
            const err = result.reason
            failed.push({
                feedUrl: parsed.data[i],
                error: err instanceof FeedError ? err.message : 'Erreur inattendue',
                code:  err instanceof FeedError ? err.code   : 'UNKNOWN',
            })
        }
    }

    return c.json({
        total: success.length,
        failed: failed.length > 0 ? failed : undefined,
        feeds: success,
    })
})

// GET /articles/:username/articles
articlesRoute.get('/:username/articles', async (c) => {
    const username: string = String(c.req.param('username'))
    const size = Number(c.req.query('size') ?? 100)
    const index = Number(c.req.query('index') ?? 0)
    const searchKey = c.req.query('searchKey') || null

    const user = await getUserByUsername(username)
    if (!user) return c.json({ error: 'Utilisateur introuvable' }, 404)

    const offset = index * size
    const articles = await getArticlesByUser(user.id, size, offset, searchKey)
    const total = await countArticlesByUser(user.id, searchKey)

    return c.json({
        total,
        size,
        index,
        objects: articles
    })
})

// GET /articles/:username/feed/:feedId
articlesRoute.get('/:username/feed/:feedId', async (c) => {
    const username: string = String(c.req.param('username'))
    const feedId: number = Number(c.req.param('feedId'))
    const size = Number(c.req.query('size') ?? 100)
    const index = Number(c.req.query('index') ?? 0)
    const searchKey = c.req.query('searchKey') || null

    const user = await getUserByUsername(username)
    if (!user) return c.json({ error: 'Utilisateur introuvable' }, 404)

    const offset = index * size
    const articles = await getArticlesByUserAndFeed(user.id, feedId, size, offset, searchKey)
    const total = await countArticlesByUserAndFeed(user.id, feedId, searchKey)

    return c.json({
        total,
        size,
        index,
        objects: articles
    })
})

// GET /articles/:id
articlesRoute.get('/:id', async (c) => {
    const id = Number(c.req.param('id'))
    if (isNaN(id)) return c.json({ error: 'ID invalide' }, 400)
    
    const article = await getArticleById(id)
    if (!article) return c.json({ error: 'Article introuvable' }, 404)
    return c.json(article)
})

export default articlesRoute
