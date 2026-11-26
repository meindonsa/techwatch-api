import { randomBytes } from 'node:crypto'
import NodeCache from 'node-cache'

/**
 * Codes de connexion à usage unique.
 *
 * Après le callback OAuth, l'API redirige le navigateur vers le front avec un code
 * court (60 s, utilisable une seule fois) au lieu de mettre les JWT dans l'URL.
 * Le front échange ce code contre la session via POST /auth/oauth/exchange.
 *
 * Stockage en mémoire : suffisant tant que l'API tourne en une seule instance.
 * Avec plusieurs instances, il faudrait une table en base ou un cache partagé.
 */
const CODE_TTL_SECONDS = 60

const codes = new NodeCache({ stdTTL: CODE_TTL_SECONDS, checkperiod: 30, useClones: false })

export function createLoginCode(userId: number): string {
    const code = randomBytes(32).toString('base64url')
    codes.set(code, userId)
    return code
}

/** Retourne l'id utilisateur et invalide le code (un second appel renvoie undefined). */
export function consumeLoginCode(code: string): number | undefined {
    return codes.take<number>(code)
}
