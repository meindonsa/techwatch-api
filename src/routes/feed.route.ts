import { Hono } from 'hono'
import {upsertFeed, getFeedById, deleteFeed} from '../repositories/feed.repository.js'
import {
    subscribeUserToFeed,
    unsubscribeUserFromFeed,
    getFeedsByUser
} from '../repositories/user-feed.repository.js'
import { insertArticles } from '../repositories/article.repository.js'
import { getArticles } from '../services/article.service.js'
import {detectSource, type SourceDetectionResult} from '../services/detection.service.js'
import { getUserByUsername, getUserById } from '../repositories/user.repository.js'
import {FeedError, FeedErrors} from '../utils/errors.js'
import {createFeed, nameSchema} from "../validators/feed.validator.js";

type AuthVariables = {
    userId: number
    username: string
}

const feedRoute = new Hono<{ Variables: AuthVariables }>()

// POST /feeds/:username
feedRoute.post('/:username', async (c) => {
    const authUsername = c.get('username') as string
    const username: string = c.req.param('username');

    if (authUsername !== username) {
        return c.json({ error: 'Accès refusé' }, 403)
    }

    const body = await c.req.json()
    const parsed = createFeed.safeParse(body)

    if (!parsed.success) {
        return c.json({ error: parsed.error.issues[0].message }, 400)
    }

    const user = await getUserByUsername(username)
    if (!user) return c.json({ error: 'Utilisateur introuvable' }, 404)

    const detection: SourceDetectionResult = await detectSource(parsed.data.url)
    if (!detection.feedUrl)
        return c.json({ error: 'Aucun flux RSS détecté sur ce site', code: 'NO_FEED' }, 422)

    try {
        const feedData = await getArticles(detection.feedUrl)

        const feed = await upsertFeed({
            type: detection.type === 'atom' ? 'atom' : 'rss',
            feed_url: detection.feedUrl,
            original_url: parsed.data.url,
            name: feedData.title,
        })

        const subscription = await subscribeUserToFeed(user.id, feed.id)

        const inserted = await insertArticles(feedData.articles.map((a) => ({
            feed_id: feed.id,
            title: a.title,
            link: a.link,
            pub_date: a.date,
            summary: a.summary,
            author: a.author,
            image: a.image,
        })))

        return c.json({ feed, subscription, articlesInserted: inserted }, 201)
    } catch (e) {
        if (e instanceof FeedError) {
            const status = e.code === 'NOT_FOUND' ? 404 : 422
            return c.json({ error: e.message, code: e.code }, status)
        }
        return c.json({ error: 'Erreur inattendue' }, 500)
    }
})

// DELETE /feeds/:feedId/users/:username
feedRoute.delete('/:feedId/users/:username', async (c) => {
    const authUsername = c.get('username') as string
    const username: string = String(c.req.param('username'))

    if (authUsername !== username) {
        return c.json({ error: 'Accès refusé' }, 403)
    }

    const user = await getUserByUsername(username)
    if (!user) return c.json({ error: FeedErrors.USER_NOT_FOUND.message }, 404)

    const feed = await getFeedById(Number(c.req.param('feedId')))
    if (!feed) return c.json({ error: FeedErrors.FEED_NOT_FOUND.message }, 404)

    await unsubscribeUserFromFeed(user.id, feed.id)
    return c.json({ message: FeedErrors.UNSUBSCRIBE_SUCCESS.message })
})

// GET /feeds/by-username/:username
feedRoute.get('/by-username/:username', async (c) => {
    const authUsername = c.get('username') as string
    const username = c.req.param('username')

    if (authUsername !== username) {
        return c.json({ error: 'Accès refusé' }, 403)
    }

    const user = await getUserByUsername(username)
    if (!user) return c.json({ error: 'Utilisateur introuvable' }, 404)

    const feeds = await getFeedsByUser(user.id)
    return c.json(feeds)
})

export default feedRoute
