export const OAUTH_PROVIDERS = ['google', 'github'] as const

export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number]

export function isOAuthProvider(value: string): value is OAuthProvider {
    return (OAUTH_PROVIDERS as readonly string[]).includes(value)
}

/**
 * Codes d'erreur renvoyés au front dans `?error=` après un échec du flux OAuth.
 */
export type OAuthErrorCode =
    | 'not_configured'
    | 'invalid_state'
    | 'access_denied'
    | 'email_not_verified'
    | 'email_exists'
    | 'already_linked'
    | 'provider_already_linked'
    | 'provider_error'

export class OAuthError extends Error {
    constructor(public readonly code: OAuthErrorCode, message?: string) {
        super(message ?? code)
        this.name = 'OAuthError'
    }
}

/**
 * Identité normalisée renvoyée par un provider, quel qu'il soit.
 */
export interface OAuthProfile {
    provider: OAuthProvider
    providerUserId: string
    email: string
    emailVerified: boolean
    name: string
}
