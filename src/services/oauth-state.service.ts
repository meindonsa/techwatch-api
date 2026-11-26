import NodeCache from 'node-cache'
import type { OAuthProvider } from '../utils/oauth.js'

/**
 * État d'un flux de LIAISON (utilisateur déjà connecté qui ajoute Google/GitHub).
 *
 * Contrairement au flux de connexion, le front appelle l'API en `fetch` (avec son Bearer),
 * puis navigue lui-même vers le provider : un cookie posé par cette réponse cross-site serait
 * ignoré par les navigateurs. On lie donc le `state` à l'utilisateur côté serveur.
 *
 * Le `state` est un secret aléatoire de 256 bits connu uniquement du navigateur authentifié
 * qui l'a demandé : un attaquant ne peut pas fabriquer un lien qui rattache SON compte
 * Google à la victime. Usage unique (`take`), expiration 10 minutes.
 *
 * Stockage en mémoire : suffisant pour une instance unique (comme oauth-code.service).
 */
const STATE_TTL_SECONDS = 600

export interface LinkState {
    userId: number
    provider: OAuthProvider
    codeVerifier?: string
}

const states = new NodeCache({ stdTTL: STATE_TTL_SECONDS, checkperiod: 60, useClones: false })

export function saveLinkState(state: string, data: LinkState): void {
    states.set(state, data)
}

/** Retourne l'état et l'invalide (un second appel renvoie undefined). */
export function takeLinkState(state: string): LinkState | undefined {
    return states.take<LinkState>(state)
}
