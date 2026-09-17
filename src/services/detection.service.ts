import Parser from 'rss-parser'
import { parse } from 'node-html-parser'
import { fetchWithSizeLimit } from '../middlewares/size-limit.middleware.js'

export interface SourceDetectionResult {
    type: 'rss' | 'atom' | 'none'
    feedUrl: string | null
    detectionMethod: string
    originalUrl: string
}

const RSS_INDICATORS = ['/feed', '/rss', '/atom', '.xml', '/feeds']

const COMMON_RSS_PATHS = [
    '/feed',
    '/rss',
    '/atom',
    '/feed.xml',
    '/rss.xml',
    '/atom.xml',
    '/index.xml',
    '/feeds/posts/default', // Blogger
]

const rssParser = new Parser({
    timeout: 10000,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TechWatchBot/1.0)' },
})

function normalizeUrl(url: string): string {
    const cleaned = url.replace(/"/g, '').trim()
    return /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`
}

function isLikelyRssUrl(url: string): boolean {
    const lower = url.toLowerCase()
    return RSS_INDICATORS.some((indicator) => lower.includes(indicator))
}

async function isValidRssFeed(url: string): Promise<boolean> {
    try {
        await rssParser.parseURL(url)
        return true
    } catch {
        return false
    }
}

async function findFeedInHtml(url: string): Promise<string | null> {
    try {
        const res = await fetchWithSizeLimit(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TechWatchBot/1.0)' },
        })

        if (!res.ok) return null

        const html = await res.text()
        const root = parse(html)

        const feedLinks = root.querySelectorAll('link[type*="rss"], link[type*="atom"], link[type*="xml"]')
        for (const link of feedLinks) {
            const href = link.getAttribute('href')
            if (href) {
                const absoluteUrl = new URL(href, url).href
                if (await isValidRssFeed(absoluteUrl)) return absoluteUrl
            }
        }

        const alternateLinks = root.querySelectorAll('link[rel="alternate"]')
        for (const link of alternateLinks) {
            const type = link.getAttribute('type') ?? ''
            if (type.includes('rss') || type.includes('atom') || type.includes('xml')) {
                const href = link.getAttribute('href')
                if (href) {
                    const absoluteUrl = new URL(href, url).href
                    if (await isValidRssFeed(absoluteUrl)) return absoluteUrl
                }
            }
        }
    } catch {
        return null
    }

    return null
}

async function tryCommonPaths(url: string): Promise<string | null> {
    try {
        const { protocol, host } = new URL(url)
        const base = `${protocol}//${host}`

        for (const path of COMMON_RSS_PATHS) {
            const testUrl = `${base}${path}`
            if (await isValidRssFeed(testUrl)) return testUrl
        }
    } catch {
        return null
    }

    return null
}

export async function detectSource(input: string): Promise<SourceDetectionResult> {
    const originalUrl = normalizeUrl(input)

    if (isLikelyRssUrl(originalUrl) && await isValidRssFeed(originalUrl)) {
        return { type: 'rss', feedUrl: originalUrl, detectionMethod: 'URL directe', originalUrl }
    }

    const htmlFeed = await findFeedInHtml(originalUrl)
    if (htmlFeed) {
        return { type: 'rss', feedUrl: htmlFeed, detectionMethod: 'Balise <link> dans le HTML', originalUrl }
    }

    const commonFeed = await tryCommonPaths(originalUrl)
    if (commonFeed) {
        return { type: 'rss', feedUrl: commonFeed, detectionMethod: 'URL commune (/feed, /rss, etc.)', originalUrl }
    }

    return { type: 'none', feedUrl: null, detectionMethod: 'Aucun flux trouvé', originalUrl }
}