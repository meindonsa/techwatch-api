export class FeedError extends Error {
    constructor(
        public code: 'TIMEOUT' | 'NOT_FOUND' | 'INVALID_URL' | 'PARSE_ERROR' | 'UNREACHABLE' | 'USER_NOT_FOUND' | 'SUCCESS' | 'TOO_LARGE',
        message: string
    ) {
        super(message)
        this.name = 'FeedError'
    }
}

export const FeedErrors = {
    TIMEOUT:     new FeedError('TIMEOUT',     'Le site a mis trop de temps à répondre'),
    NOT_FOUND:   new FeedError('NOT_FOUND',   'Aucun flux RSS/Atom trouvé sur ce site'),
    INVALID_URL: new FeedError('INVALID_URL', 'URL invalide ou inaccessible'),
    PARSE_ERROR: new FeedError('PARSE_ERROR', 'Impossible de lire le contenu du flux'),
    UNREACHABLE: new FeedError('UNREACHABLE', 'Site inaccessible ou inexistant'),
    USER_NOT_FOUND: new FeedError('NOT_FOUND', 'Utilisateur introuvable'),
    FEED_NOT_FOUND: new FeedError('NOT_FOUND', 'Feed introuvable'),
    SUBSCRIBE_NOT_FOUND: new FeedError('NOT_FOUND', 'Souscription introuvable'),
    UNSUBSCRIBE_SUCCESS: new FeedError('SUCCESS', 'Désabonnement effectué'),
}