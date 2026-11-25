import { describe, it, expect, vi, beforeEach } from 'vitest'

// Ici rss-parser n'est PAS mocké : on vérifie l'extraction sur de vrais formats de flux.
// Seul le téléchargement est simulé.
const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }))

vi.mock('../middlewares/size-limit.middleware.js', () => ({
    fetchWithSizeLimit: mockFetch,
}))

const { getArticlesIfModified } = await import('../services/article.service.js')

const FEED_URL = 'https://example.com/feed'

async function imagesOf(xml: string): Promise<(string | null)[]> {
    mockFetch.mockResolvedValueOnce(new Response(xml, { status: 200 }))
    const result = await getArticlesIfModified(FEED_URL)
    if (result.notModified) throw new Error('réponse 304 inattendue')
    return result.data.articles.map((a) => a.image)
}

const rss = (items: string, extraNamespaces = '') => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" ${extraNamespaces}>
<channel>
    <title>Test</title>
    <link>https://example.com/</link>
    ${items}
</channel>
</rss>`

beforeEach(() => {
    mockFetch.mockReset()
})

describe('extraction de l’image d’un article', () => {
    it('FrAndroid : lit la première <img> de content:encoded (pas d’enclosure ni de media:content)', async () => {
        // Extrait réel du flux https://www.frandroid.com/feed
        const xml = rss(`
        <item>
            <title>La Renault Twingo électrique bat un record de consommation</title>
            <link>https://www.frandroid.com/marques/3337509_la-renault-twingo</link>
            <dc:creator><![CDATA[Jean-Baptiste Passieux]]></dc:creator>
            <pubDate>Wed, 25 Nov 2026 10:00:13 +0000</pubDate>
            <guid>https://www.frandroid.com/marques/3337509_la-renault-twingo</guid>
            <description><![CDATA[<div class="chapo"><div>La nouvelle Renault Twingo électrique a parcouru 8,33 km par kWh.</div></div>]]></description>
            <content:encoded><![CDATA[<p><img width="1200" height="675" src="https://img.frandroid.com/images.frandroid.com/wp-content/uploads/2026/07/img-1643.jpg?resize=1200,675&key=e7e3595c" class="attachment-full size-full wp-post-image" alt="" decoding="async" loading="lazy" /></p><p><div class="chapo"><div>La nouvelle Renault Twingo électrique a parcouru 8,33 km par kWh.</div></div></p>&nbsp;<a href="https://www.frandroid.com/marques/3337509_la-renault-twingo?utm_medium=distibuted" target="_blank">[Lire la suite]</a>]]></content:encoded>
        </item>`)

        expect(await imagesOf(xml)).toEqual([
            'https://img.frandroid.com/images.frandroid.com/wp-content/uploads/2026/07/img-1643.jpg?resize=1200,675&key=e7e3595c',
        ])
    })

    it('Les Numériques (Atom) : lit media:content en priorité', async () => {
        // Extrait réel du flux https://www.lesnumeriques.com/rss-news.xml
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
    <title>Les Numériques - Toute l'actualité</title>
    <link rel="alternate" type="text/html" href="https://www.lesnumeriques.com/" />
    <updated>2026-11-25T10:48:00+01:00</updated>
    <id>https://www.lesnumeriques.com/</id>
    <entry>
        <title><![CDATA[ Les Anneaux de pouvoir : la série aura-t-elle une saison 4 ? ]]></title>
        <link href="https://www.lesnumeriques.com/serie/les-anneaux-de-pouvoir-n268505.html" />
        <id>tag:www.lesnumeriques.com,2004:2/268505</id>
        <updated>2026-11-25T10:48:00+01:00</updated>
        <summary><![CDATA[ La série dérivée du Seigneur des anneaux. ]]></summary>
        <author><name>Marine Pérot</name></author>
        <content type="html" xml:lang="fr"><![CDATA[ Texte...<br><img src="https://cdn.lesnumeriques.com/optim/news/26/268505/af765a98-cover.jpg" /> ]]></content>
        <media:content url="https://cdn.lesnumeriques.com/optim/news/26/268505/af765a98-cover__800_800__359-0-1609-1250.jpg" type="image/jpeg" expression="full" width="800" height="800" />
    </entry>
</feed>`

        expect(await imagesOf(xml)).toEqual([
            'https://cdn.lesnumeriques.com/optim/news/26/268505/af765a98-cover__800_800__359-0-1609-1250.jpg',
        ])
    })

    it('utilise enclosure quand il est présent', async () => {
        const xml = rss(`
        <item>
            <title>Avec enclosure</title>
            <link>https://example.com/1</link>
            <enclosure url="https://example.com/img/enclosure.jpg" type="image/jpeg" length="0" />
        </item>`)

        expect(await imagesOf(xml)).toEqual(['https://example.com/img/enclosure.jpg'])
    })

    it('utilise media:thumbnail quand il est présent', async () => {
        const xml = rss(
            `<item>
                <title>Avec thumbnail</title>
                <link>https://example.com/1</link>
                <media:thumbnail url="https://example.com/img/thumb.jpg" />
            </item>`,
            'xmlns:media="http://search.yahoo.com/mrss/"'
        )

        expect(await imagesOf(xml)).toEqual(['https://example.com/img/thumb.jpg'])
    })

    it('se rabat sur la première <img> du champ description / content', async () => {
        const xml = rss(`
        <item>
            <title>Image dans la description</title>
            <link>https://example.com/1</link>
            <description><![CDATA[<p>Résumé</p><img src='https://example.com/img/desc.jpg' alt="">]]></description>
        </item>`)

        expect(await imagesOf(xml)).toEqual(['https://example.com/img/desc.jpg'])
    })

    it('préfère enclosure/media:content à l’<img> trouvée dans le HTML', async () => {
        const xml = rss(`
        <item>
            <title>Priorité</title>
            <link>https://example.com/1</link>
            <enclosure url="https://example.com/img/enclosure.jpg" type="image/jpeg" length="0" />
            <content:encoded><![CDATA[<img src="https://example.com/img/html.jpg" />]]></content:encoded>
        </item>`)

        expect(await imagesOf(xml)).toEqual(['https://example.com/img/enclosure.jpg'])
    })

    it('renvoie null quand aucune image n’est disponible', async () => {
        const xml = rss(`
        <item>
            <title>Sans image</title>
            <link>https://example.com/1</link>
            <description>Juste du texte</description>
            <content:encoded><![CDATA[<p>Pas d'image ici</p>]]></content:encoded>
        </item>`)

        expect(await imagesOf(xml)).toEqual([null])
    })
})
