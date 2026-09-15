import { Hono } from 'hono'
import {getArticles} from "../services/article.service.js";
import {urlArraySchema, urlSchema} from "../validators/feed.validator.js";
import {FeedError} from "../utils/errors.js";
import {getUserByUsername} from "../repositories/user.repository.js";
import {getArticlesByUser, getArticlesByUserAndFeed} from "../repositories/article.repository.js";
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

// GET /articles/:username/articles — lister les articles d'un user
articlesRoute.get('/:username/articles', async (c) => {
    const username: string = String(c.req.param('username'))
    const limit = Number(c.req.query('limit') ?? 100)

    const user = await getUserByUsername(username)
    if (!user) return c.json({ error: 'Utilisateur introuvable' }, 404)

    const articles = await getArticlesByUser(user.id, limit)
    return c.json(articles)
})

// GET /articles/:username/feed/:feedId — lister les articles d'un feed
articlesRoute.post('/:username/feed/:feedId', async (c) => {
    const username: string = String(c.req.param('username'))
    const feedId: number = Number(c.req.param('feedId'))
    const limit = Number(c.req.query('limit') ?? 100)

    const user = await getUserByUsername(username)
    if (!user) return c.json({ error: 'Utilisateur introuvable' }, 404)

    const articles = await getArticlesByUserAndFeed(user.id, feedId, limit)
    return c.json(articles)
})
export default articlesRoute