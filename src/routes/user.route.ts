import { Hono } from 'hono'
import { z } from 'zod'
import { createUser, getUserById, getUserByUsername, usernameExists, updatePassword } from '../repositories/user.repository.js'
import { getArticlesByUser } from '../repositories/article.repository.js'
import {createUserSchema} from "../validators/feed.validator.js";

const userRoute = new Hono()

// GET /users/me — récupérer son propre profil ✅
userRoute.get('/me', async (c) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Utilisateur non authentifié' }, 401)

    const user = await getUserById(userId)
    if (!user) return c.json({ error: 'Utilisateur introuvable' }, 404)

    const { password, ...userWithoutPassword } = user
    return c.json(userWithoutPassword)
})

// PATCH /users/me/password — changer son mot de passe
userRoute.patch('/me/password', async (c) => {
    const userId = c.get('userId')
    const { newPassword } = await c.req.json()

    if (!newPassword || newPassword.length < 6) {
        return c.json({ error: 'Le mot de passe doit contenir au moins 6 caractères' }, 400)
    }

    try {
        await updatePassword(userId, newPassword)
        return c.json({ message: 'Mot de passe mis à jour avec succès' })
    } catch (e) {
        return c.json({ error: 'Erreur lors de la mise à jour du mot de passe' }, 500)
    }
})

// GET /users/check-username?username=xxx ✅
userRoute.get('/check-username', async (c) => {
    const username = c.req.query('username')

    if (!username || username.trim() === '')
        return c.json({ error: 'Le paramètre username est requis' }, 400)


    const taken = await usernameExists(username.trim())
    return c.json({ username: username.trim(), available: !taken })
})

// GET /users/:id/articles — lister les articles d'un user
userRoute.get('/:id/articles', async (c) => {
    const userId = Number(c.req.param('id'))
    const limit = Number(c.req.query('limit') ?? 100)

    const user = await getUserById(userId)
    if (!user) return c.json({ error: 'Utilisateur introuvable' }, 404)

    const articles = await getArticlesByUser(userId, limit)
    return c.json(articles)
})

export default userRoute