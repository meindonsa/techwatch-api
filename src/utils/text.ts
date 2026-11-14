/**
 * Nettoie les espaces et tronque un texte à `max` caractères (ellipse comprise).
 * Coupe de préférence sur une limite de mot et ne sépare jamais une paire de substitution (emoji).
 * Retourne null si le texte est vide.
 */
export function truncateText(text: string | null | undefined, max: number): string | null {
    if (!text) return null

    const clean = text.replace(/\s+/g, ' ').trim()
    if (!clean) return null
    if (clean.length <= max) return clean

    let slice = clean.slice(0, Math.max(1, max - 1))

    const lastCode = slice.charCodeAt(slice.length - 1)
    if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
        slice = slice.slice(0, -1)
    }

    const lastSpace = slice.lastIndexOf(' ')
    if (lastSpace > max * 0.6) {
        slice = slice.slice(0, lastSpace)
    }

    return `${slice.trimEnd()}…`
}
