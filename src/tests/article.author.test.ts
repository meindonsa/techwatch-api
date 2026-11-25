import { describe, it, expect, vi, beforeEach } from 'vitest'

// rss-parser n'est PAS mocké : on vérifie la lecture de l'auteur sur de vrais formats de flux.
// Seul le téléchargement est simulé.
const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }))

vi.mock('../middlewares/size-limit.middleware.js', () => ({
    fetchWithSizeLimit: mockFetch,
}))

const { getArticlesIfModified } = await import('../services/article.service.js')

const FEED_URL = 'https://example.com/feed'

async function authorsOf(xml: string): Promise<(string | null)[]> {
    mockFetch.mockResolvedValueOnce(new Response(xml, { status: 200 }))
    const result = await getArticlesIfModified(FEED_URL)
    if (result.notModified) throw new Error('réponse 304 inattendue')
    return result.data.articles.map((a) => a.author)
}

const rss = (items: string) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
    <title>Test</title>
    <link>https://example.com/</link>
    ${items}
</channel>
</rss>`

const atom = (entries: string) => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
    <title>Test</title>
    <link rel="alternate" type="text/html" href="https://example.com/" />
    <updated>2026-11-25T10:48:00+01:00</updated>
    <id>https://example.com/</id>
    ${entries}
</feed>`

beforeEach(() => {
    mockFetch.mockReset()
})

describe('extraction de l’auteur d’un article', () => {
    it('Les Numériques (Atom) : lit <author><name>', async () => {
        // Extrait réel du flux https://www.lesnumeriques.com/rss-news.xml
        const xml = atom(`
        <entry>
            <title><![CDATA[ Les Anneaux de pouvoir : la série aura-t-elle une saison 4 ? ]]></title>
            <link href="https://www.lesnumeriques.com/serie/les-anneaux-de-pouvoir-n268505.html" />
            <id>tag:www.lesnumeriques.com,2004:2/268505</id>
            <updated>2026-11-25T10:48:00+01:00</updated>
            <author>
                <name>Marine Pérot</name>
            </author>
        </entry>
        <entry>
            <title><![CDATA[ Black Friday – Les Apple AirPods Pro 3 tombent à 188 € ]]></title>
            <link href="https://www.lesnumeriques.com/ecouteurs-sans-fil/airpods-n268308.html" />
            <id>tag:www.lesnumeriques.com,2004:2/268308</id>
            <updated>2026-11-25T09:19:35+01:00</updated>
            <author>
                <name>Arthur Letang</name>
            </author>
        </entry>`)

        expect(await authorsOf(xml)).toEqual(['Marine Pérot', 'Arthur Letang'])
    })

    it('FrAndroid (RSS 2.0) : lit <dc:creator>', async () => {
        // Extrait réel du flux https://www.frandroid.com/feed
        const xml = rss(`
        <item>
            <title>La Renault Twingo électrique bat un record de consommation</title>
            <link>https://www.frandroid.com/marques/3337509_la-renault-twingo</link>
            <dc:creator><![CDATA[Jean-Baptiste Passieux]]></dc:creator>
        </item>`)

        expect(await authorsOf(xml)).toEqual(['Jean-Baptiste Passieux'])
    })

    it('RSS 2.0 : lit <author> quand il n’y a pas de dc:creator', async () => {
        const xml = rss(`
        <item>
            <title>Avec author</title>
            <link>https://example.com/1</link>
            <author>Boris</author>
        </item>`)

        expect(await authorsOf(xml)).toEqual(['Boris'])
    })

    it('préfère dc:creator à <author> quand les deux existent', async () => {
        const xml = rss(`
        <item>
            <title>Les deux</title>
            <link>https://example.com/1</link>
            <dc:creator>Auteur dc</dc:creator>
            <author>Auteur rss</author>
        </item>`)

        expect(await authorsOf(xml)).toEqual(['Auteur dc'])
    })

    it('se rabat sur <author> quand dc:creator est vide', async () => {
        const xml = rss(`
        <item>
            <title>creator vide</title>
            <link>https://example.com/1</link>
            <dc:creator></dc:creator>
            <author>Auteur rss</author>
        </item>`)

        expect(await authorsOf(xml)).toEqual(['Auteur rss'])
    })

    it('renvoie null quand aucun auteur n’est disponible', async () => {
        const xml = rss(`
        <item>
            <title>Sans auteur</title>
            <link>https://example.com/1</link>
        </item>`)

        expect(await authorsOf(xml)).toEqual([null])
    })

    it('tronque un nom d’auteur trop long', async () => {
        const long = 'A'.repeat(300)
        const xml = atom(`
        <entry>
            <title>Auteur interminable</title>
            <link href="https://example.com/1" />
            <id>tag:example.com,2026:1</id>
            <updated>2026-11-25T10:48:00+01:00</updated>
            <author><name>${long}</name></author>
        </entry>`)

        const [author] = await authorsOf(xml)
        expect(author).not.toBeNull()
        expect(author!.length).toBeLessThanOrEqual(200)
    })
})
