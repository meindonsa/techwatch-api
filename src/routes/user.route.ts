import { Hono } from 'hono'
import { z } from 'zod'
import { getUserById, updatePassword, deleteUser, verifyPassword, updateFullName, usernameExists } from '../repositories/user.repository.js'
import { getArticlesByUser } from '../repositories/article.repository.js'
import { deleteUserRefreshTokens } from '../repositories/refresh-token.repository.js'

type AuthVariables = {
    userId: number
    username: string
    email: string
}

const userRoute = new Hono<{ Variables: AuthVariables }>()

// GET /users/me — récupérer son propre profil
userRoute.get('/me', async (c) => {
    const userId = c.get('userId') as number
    if (!userId) return c.json({ error: 'Utilisateur non authentifié' }, 401)

    const user = await getUserById(userId)
    if (!user) return c.json({ error: 'Utilisateur introuvable' }, 404)

    const { password, ...userWithoutPassword } = user
    return c.json(userWithoutPassword)
})

// PATCH /users/me — mettre à jour son nom complet
userRoute.patch('/me', async (c) => {
    const userId = c.get('userId') as number
    const { full_name } = await c.req.json()

    if (!full_name || full_name.trim() === '') {
        return c.json({ error: 'Le nom complet est requis' }, 400)
    }

    try {
        const user = await getUserById(userId)
        if (!user) return c.json({ error: 'Utilisateur introuvable' }, 404)

        await updateFullName(userId, full_name.trim())
        
        const updatedUser = await getUserById(userId)
        const { password, ...userWithoutPassword } = updatedUser!
        return c.json(userWithoutPassword)
    } catch (e) {
        return c.json({ error: 'Erreur lors de la mise à jour du nom' }, 500)
    }
})

// PATCH /users/me/password — changer son mot de passe
userRoute.patch('/me/password', async (c) => {
    const userId = c.get('userId') as number
    const { currentPassword, newPassword } = await c.req.json()

    if (!currentPassword) {
        return c.json({ error: 'Le mot de passe actuel est requis' }, 400)
    }

    if (!newPassword || newPassword.length < 12) {
        return c.json({ error: 'Le nouveau mot de passe doit contenir au moins 12 caractères' }, 400)
    }

    if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword) || !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(newPassword)) {
        return c.json({ error: 'Le nouveau mot de passe doit contenir au moins : 1 majuscule, 1 minuscule, 1 chiffre, 1 caractère spécial' }, 400)
    }

    try {
        const user = await getUserById(userId)
        if (!user) return c.json({ error: 'Utilisateur introuvable' }, 404)

        const isValid = await verifyPassword(user.password, currentPassword)
        if (!isValid) {
            return c.json({ error: 'Mot de passe actuel incorrect' }, 401)
        }

        await updatePassword(userId, newPassword)
        await deleteUserRefreshTokens(userId)
        return c.json({ message: 'Mot de passe mis à jour avec succès' })
    } catch (e) {
        return c.json({ error: 'Erreur lors de la mise à jour du mot de passe' }, 500)
    }
})

// DELETE /users/me — supprimer son propre compte
userRoute.delete('/me', async (c) => {
    const userId = c.get('userId') as number
    if (!userId) return c.json({ error: 'Utilisateur non authentifié' }, 401)

    try {
        await deleteUserRefreshTokens(userId)
        await deleteUser(userId)
        return c.json({ message: 'Compte supprimé avec succès' })
    } catch (e) {
        return c.json({ error: 'Erreur lors de la suppression du compte' }, 500)
    }
})

// GET /users/check-username?username=xxx
userRoute.get('/check-username', async (c) => {
    const username = c.req.query('username')

    if (!username || username.trim() === '')
        return c.json({ error: 'Le paramètre username est requis' }, 400)


    const taken = await usernameExists(username.trim())
    return c.json({ username: username.trim(), available: !taken })
})

// GET /users/:id/articles — lister les articles d'un user
userRoute.get('/:id/articles', async (c) => {
    const authUserId = c.get('userId') as number
    const userId = Number(c.req.param('id'))

    if (authUserId !== userId) {
        return c.json({ error: 'Accès refusé' }, 403)
    }

    const limit = Number(c.req.query('limit') ?? 100)

    const user = await getUserById(userId)
    if (!user) return c.json({ error: 'Utilisateur introuvable' }, 404)

    const articles = await getArticlesByUser(userId, limit)
    return c.json(articles)
})

export default userRoute
