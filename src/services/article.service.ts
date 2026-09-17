import Parser from 'rss-parser'
import {FeedError} from "../utils/errors.js";

type CustomItem = {
    title: string
    link: string
    pubDate: string
    content: string
    creator: string
    enclosure?: { url: string }
    'media:content'?: { $: { url: string } }
}

const MAX_ARTICLES_PER_FEED = 100

const rssParser = new Parser<object, CustomItem>({
    timeout: 10000,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TechWatchBot/1.0)' },
    customFields: {
        item: ['media:content', 'enclosure'],
    },
})

export interface Article {
    title: string
    link: string
    date: string | null
    summary: string | null
    author: string | null
    image: string | null
}

export interface FeedResult {
    feedUrl: string
    title: string
    articles: Article[]
}

function extractImage(item: CustomItem): string | null {
    if (item['media:content']?.$?.url) return item['media:content'].$.url
    if (item.enclosure?.url) return item.enclosure.url
    return null
}

export async function getArticles(feedUrl: string): Promise<FeedResult> {
    try {
        const feed = await rssParser.parseURL(feedUrl)
        const articles = feed.items.slice(0, MAX_ARTICLES_PER_FEED)

        return {
            feedUrl,
            title: feed.title ?? 'Sans titre',
            articles: articles.map((item) => ({
                title: item.title ?? 'Sans titre',
                link: item.link ?? '',
                date: item.pubDate ?? null,
                summary: item.contentSnippet ?? null,
                author: item.creator ?? null,
                image: extractImage(item),
            })),
        }
    }catch (e: any) {
        if (e.code === 'ETIMEDOUT' || e.message?.includes('timeout')) {
            throw new FeedError('TIMEOUT', 'Le site a mis trop de temps à répondre')
        }
        if (e.code === 'ENOTFOUND' || e.code === 'ECONNREFUSED') {
            throw new FeedError('UNREACHABLE', 'Site inaccessible ou inexistant')
        }
        if (e.message?.includes('Status code')) {
            throw new FeedError('NOT_FOUND', 'Aucun flux trouvé à cette URL')
        }
        if (e.message?.includes('trop volumineuse') || e.message?.includes('Too large')) {
            throw new FeedError('TOO_LARGE', 'Réponse trop volumineuse')
        }
        throw new FeedError('PARSE_ERROR', 'Impossible de lire le contenu du flux')
    }
}