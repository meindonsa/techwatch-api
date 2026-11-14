import Parser from 'rss-parser'
import {FeedError} from "../utils/errors.js";
import {truncateText} from "../utils/text.js";
import {fetchWithSizeLimit} from "../middlewares/size-limit.middleware.js";

type CustomItem = {
    title: string
    link: string
    pubDate: string
    content: string
    creator: string
    enclosure?: { url: string }
    'media:content'?: { $: { url: string } }
}

/** Nombre maximum d'articles lus à chaque récupération d'un flux. */
export const MAX_ARTICLES_PER_FEED = 100

const MAX_REDIRECTS = 5
const USER_AGENT = 'Mozilla/5.0 (compatible; TechWatchBot/1.0)'
const TITLE_MAX_LENGTH = 500
const AUTHOR_MAX_LENGTH = 200

const rssParser = new Parser<object, CustomItem>({
    timeout: 10000,
    headers: { 'User-Agent': USER_AGENT },
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

/** Validateurs HTTP mémorisés pour un flux (requêtes conditionnelles). */
export interface FeedValidators {
    etag?: string | null
    lastModified?: string | null
}

export type ConditionalFeedResult =
    | { notModified: true }
    | { notModified: false; data: FeedResult; etag: string | null; lastModified: string | null }

function extractImage(item: CustomItem): string | null {
    if (item['media:content']?.$?.url) return item['media:content'].$.url
    if (item.enclosure?.url) return item.enclosure.url
    return null
}

function toFeedResult(feedUrl: string, feed: Parser.Output<CustomItem>): FeedResult {
    return {
        feedUrl,
        title: feed.title ?? 'Sans titre',
        articles: feed.items.slice(0, MAX_ARTICLES_PER_FEED).map((item) => ({
            title: truncateText(item.title, TITLE_MAX_LENGTH) ?? 'Sans titre',
            link: item.link ?? '',
            date: item.pubDate ?? null,
            summary: item.contentSnippet ?? null,
            author: truncateText(item.creator, AUTHOR_MAX_LENGTH),
            image: extractImage(item),
        })),
    }
}

function toFeedError(e: any): FeedError {
    if (e instanceof FeedError) return e

    const code = e?.code ?? e?.cause?.code

    if (code === 'ETIMEDOUT' || e?.name === 'AbortError' || e?.name === 'TimeoutError' || e?.message?.includes('timeout')) {
        return new FeedError('TIMEOUT', 'Le site a mis trop de temps à répondre')
    }
    if (code === 'ENOTFOUND' || code === 'ECONNREFUSED') {
        return new FeedError('UNREACHABLE', 'Site inaccessible ou inexistant')
    }
    if (e?.message?.includes('Status code')) {
        return new FeedError('NOT_FOUND', 'Aucun flux trouvé à cette URL')
    }
    if (e?.message?.includes('trop volumineuse') || e?.message?.includes('Too large')) {
        return new FeedError('TOO_LARGE', 'Réponse trop volumineuse')
    }
    return new FeedError('PARSE_ERROR', 'Impossible de lire le contenu du flux')
}

export async function getArticles(feedUrl: string): Promise<FeedResult> {
    try {
        const feed = await rssParser.parseURL(feedUrl)
        return toFeedResult(feedUrl, feed)
    } catch (e: any) {
        throw toFeedError(e)
    }
}

/**
 * Télécharge le flux en suivant les redirections à la main
 * (fetchWithSizeLimit ne les suit pas) pour garder la limite de taille sur chaque étape.
 */
async function fetchFollowingRedirects(feedUrl: string, headers: Record<string, string>): Promise<Response> {
    let url = feedUrl

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const response = await fetchWithSizeLimit(url, { headers })

        const isRedirect = response.status >= 300 && response.status < 400 && response.status !== 304
        if (!isRedirect) return response

        const location = response.headers.get('location')
        if (!location) return response

        const next = new URL(location, url)
        if (next.protocol !== 'http:' && next.protocol !== 'https:') {
            throw new FeedError('INVALID_URL', 'Redirection vers une URL non autorisée')
        }
        url = next.href
    }

    throw new FeedError('UNREACHABLE', 'Trop de redirections')
}

/**
 * Récupère un flux avec une requête conditionnelle (If-None-Match / If-Modified-Since).
 * Si le serveur répond 304, rien n'est téléchargé ni analysé.
 * Sinon, retourne les articles ainsi que les nouveaux validateurs à mémoriser.
 */
export async function getArticlesIfModified(
    feedUrl: string,
    validators: FeedValidators = {}
): Promise<ConditionalFeedResult> {
    try {
        const headers: Record<string, string> = {
            'User-Agent': USER_AGENT,
            Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
        }
        if (validators.etag) headers['If-None-Match'] = validators.etag
        if (validators.lastModified) headers['If-Modified-Since'] = validators.lastModified

        const response = await fetchFollowingRedirects(feedUrl, headers)

        if (response.status === 304) return { notModified: true }
        if (!response.ok) throw new FeedError('NOT_FOUND', 'Aucun flux trouvé à cette URL')

        const xml = await response.text()
        const feed = await rssParser.parseString(xml)

        return {
            notModified: false,
            data: toFeedResult(feedUrl, feed),
            etag: response.headers.get('etag'),
            lastModified: response.headers.get('last-modified'),
        }
    } catch (e: any) {
        throw toFeedError(e)
    }
}
