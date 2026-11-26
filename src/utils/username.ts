import { randomInt } from 'node:crypto'

/**
 * Transforme une chaîne libre (partie locale d'un email, nom…) en base de pseudo :
 * minuscules, sans accents, caractères [a-z0-9_] uniquement, 20 caractères max.
 */
export function sanitizeUsernameBase(input: string): string {
    const base = input
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 20)

    return base.length >= 3 ? base : 'user'
}

/**
 * Pseudos à essayer dans l'ordre : la base seule d'abord (plus lisible),
 * puis des variantes avec un suffixe numérique aléatoire en cas de collision.
 */
export function usernameCandidates(email: string, fallbackAttempts = 5): string[] {
    const base = sanitizeUsernameBase(email.split('@')[0] ?? '')
    const candidates = [base]
    for (let i = 0; i < fallbackAttempts; i++) {
        candidates.push(`${base}_${randomInt(100000, 1000000)}`)
    }
    return candidates
}
