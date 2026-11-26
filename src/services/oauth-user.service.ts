import {
    createOAuthUser,
    getUserByEmailInsensitive,
    getUserById,
    type User,
} from '../repositories/user.repository.js'
import { findOAuthAccount, linkOAuthAccount } from '../repositories/oauth-account.repository.js'
import { OAuthError, type OAuthProfile } from '../utils/oauth.js'
import { usernameCandidates } from '../utils/username.js'

function isUniqueViolation(e: any): boolean {
    return e?.code === '23505'
}

/**
 * Retrouve ou crée l'utilisateur correspondant à une identité OAuth.
 *
 * 1. Compte provider déjà lié             → connexion.
 * 2. Email non vérifié par le provider    → refus (jamais de rapprochement sur un email non vérifié).
 * 3. Email déjà utilisé par un compte avec mot de passe → refus `email_exists`.
 *    `/auth/register` ne vérifie pas l'email : fusionner automatiquement permettrait à
 *    quelqu'un qui a pré-créé un compte avec l'email de la victime de garder l'accès après
 *    sa première connexion Google/GitHub. La liaison se fera depuis un compte déjà connecté.
 * 4. Email utilisé par un compte purement OAuth (sans mot de passe) → liaison du nouveau provider.
 * 5. Sinon                                → création du compte.
 */
export async function resolveOAuthUser(profile: OAuthProfile): Promise<User> {
    const linked = await findOAuthAccount(profile.provider, profile.providerUserId)
    if (linked) {
        const user = await getUserById(linked.user_id)
        if (user) return user
    }

    if (!profile.emailVerified) {
        throw new OAuthError('email_not_verified')
    }

    const existing = await getUserByEmailInsensitive(profile.email)
    if (existing) {
        if (existing.password !== null) {
            throw new OAuthError('email_exists')
        }
        await linkOAuthAccount(existing.id, profile.provider, profile.providerUserId, profile.email)
        return existing
    }

    const fullName = profile.name.trim() || profile.email.split('@')[0]

    try {
        return await createOAuthUser(
            profile.email,
            fullName,
            profile.provider,
            profile.providerUserId,
            usernameCandidates(profile.email)
        )
    } catch (e) {
        if (!isUniqueViolation(e)) throw e

        // Deux callbacks simultanés pour le même compte : l'autre a gagné, on reprend son résultat.
        const raced = await findOAuthAccount(profile.provider, profile.providerUserId)
        if (raced) {
            const user = await getUserById(raced.user_id)
            if (user) return user
        }
        throw new OAuthError('email_exists')
    }
}
