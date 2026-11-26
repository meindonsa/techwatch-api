import {
    createOAuthUser,
    getUserByEmailInsensitive,
    getUserById,
    type User,
} from '../repositories/user.repository.js'
import {
    findOAuthAccount,
    findOAuthAccountByUser,
    linkOAuthAccount,
} from '../repositories/oauth-account.repository.js'
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

/**
 * Rattache une identité Google/GitHub à un utilisateur DÉJÀ connecté (liaison depuis le profil).
 *
 * L'utilisateur est authentifié par sa session : l'email du provider peut différer de celui du
 * compte, et il n'a pas besoin d'être vérifié (seul l'identifiant du provider compte ici).
 *
 * - Identité déjà liée à un autre utilisateur      → `already_linked`
 * - L'utilisateur a déjà un compte de ce provider  → `provider_already_linked`
 * - Identité déjà liée à ce même utilisateur       → succès (idempotent)
 */
export async function linkProfileToUser(userId: number, profile: OAuthProfile): Promise<void> {
    const taken = await findOAuthAccount(profile.provider, profile.providerUserId)
    if (taken) {
        if (taken.user_id === userId) return
        throw new OAuthError('already_linked')
    }

    const mine = await findOAuthAccountByUser(userId, profile.provider)
    if (mine) throw new OAuthError('provider_already_linked')

    const created = await linkOAuthAccount(userId, profile.provider, profile.providerUserId, profile.email || null)
    if (!created) {
        // Une contrainte d'unicité a refusé l'insertion entre-temps (appel concurrent).
        const nowTaken = await findOAuthAccount(profile.provider, profile.providerUserId)
        if (nowTaken?.user_id === userId) return
        throw new OAuthError(nowTaken ? 'already_linked' : 'provider_already_linked')
    }
}
