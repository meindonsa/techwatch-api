import { z } from 'zod'

function isValidUrl(val: string): boolean {
    try {
        const url = val.startsWith('http') ? val : `https://${val}`
        const parsed = new URL(url)
        return /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(parsed.hostname)
    } catch {
        return false
    }
}

function isStrongPassword(password: string): boolean {
    if (password.length < 12) return false
    if (!/[A-Z]/.test(password)) return false
    if (!/[a-z]/.test(password)) return false
    if (!/[0-9]/.test(password)) return false
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) return false
    return true
}

export const urlSchema = z
    .string({ error: 'URL requise' })
    .min(3, 'URL trop courte')
    .refine(isValidUrl, { message: 'URL invalide — ex: dev.to ou https://dev.to/feed' })

export const createFeed = z.object({
    url: urlSchema,
})

export const nameSchema = z.object({
    name: z.string().min(1, 'Le nom est requis'),
})

export const urlArraySchema = z
    .array(urlSchema, { error: 'Un tableau d\'URLs est requis' })
    .min(1, 'Le tableau ne peut pas être vide')
    .max(10, 'Maximum 20 URLs par requête')


export const createUserSchema = z.object({
    email: z.string().email('Email invalide'),
    full_name: z.string().min(1, 'Le nom complet est requis'),
    password: z.string()
        .min(12, 'Le mot de passe doit contenir au moins 12 caractères')
        .refine(isStrongPassword, { 
            message: 'Le mot de passe doit contenir au moins : 1 majuscule, 1 minuscule, 1 chiffre, 1 caractère spécial' 
        }),
})

export const loginSchema = z.object({
    email: z.string().email('Email invalide'),
    password: z.string().min(1, 'Le mot de passe est requis'),
})

export const forgotPasswordSchema = z.object({
    email: z.string().email('Email invalide'),
})

export const resetPasswordSchema = z.object({
    token: z.string().min(1, 'Token requis'),
    password: z.string()
        .min(12, 'Le mot de passe doit contenir au moins 12 caractères')
        .refine(isStrongPassword, { 
            message: 'Le mot de passe doit contenir au moins : 1 majuscule, 1 minuscule, 1 chiffre, 1 caractère spécial' 
        }),
})