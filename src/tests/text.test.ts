import { describe, it, expect } from 'vitest'
import { truncateText } from '../utils/text.js'

describe('truncateText', () => {
    it('retourne null pour un texte absent ou vide', () => {
        expect(truncateText(null, 300)).toBeNull()
        expect(truncateText(undefined, 300)).toBeNull()
        expect(truncateText('', 300)).toBeNull()
        expect(truncateText('   \n\t ', 300)).toBeNull()
    })

    it('normalise les espaces et retours à la ligne', () => {
        expect(truncateText('  Bonjour\n\n  le   monde  ', 300)).toBe('Bonjour le monde')
    })

    it('ne modifie pas un texte qui tient dans la limite', () => {
        expect(truncateText('Court', 5)).toBe('Court')
    })

    it('coupe sur une limite de mot et ajoute une ellipse', () => {
        const result = truncateText('Le chat dort sur le canapé toute la journée', 25)

        expect(result).toBe('Le chat dort sur le…')
        expect(result!.length).toBeLessThanOrEqual(25)
    })

    it('coupe net quand il n’y a pas d’espace utilisable', () => {
        const result = truncateText('x'.repeat(1000), 300)

        expect(result).toHaveLength(300)
        expect(result!.endsWith('…')).toBe(true)
    })

    it('ne sépare jamais une paire de substitution (emoji)', () => {
        expect(truncateText('😀'.repeat(200), 10)).toBe('😀😀😀😀…')
    })
})
