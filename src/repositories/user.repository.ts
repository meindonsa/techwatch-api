import { db } from '../db/index.js'
import bcrypt from 'bcryptjs'

export async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10)
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
    return bcrypt.compare(password, hash)
}

export interface User {
    id: number
    username: string
    email: string
    full_name: string
    password: string
    created_at: Date
}

export async function createUser(email: string, fullName: string, password: string): Promise<User> {
    const hashed = await hashPassword(password)
    const result = await db.query(`
    INSERT INTO users (email, full_name, username, password) VALUES ($1, $2, $3, $4) RETURNING *
  `, [email, fullName, email.split('@')[0] + '_' + Date.now(), hashed])
    return result.rows[0] as User
}

export async function getUserById(id: number): Promise<User | undefined> {
    const result = await db.query(`SELECT * FROM users WHERE id = $1`, [id])
    return result.rows[0] as User | undefined
}

export async function getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db.query(`SELECT * FROM users WHERE username = $1`, [username])
    return result.rows[0] as User | undefined
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
    const result = await db.query(`SELECT * FROM users WHERE email = $1`, [email])
    return result.rows[0] as User | undefined
}

export async function emailExists(email: string): Promise<boolean> {
    const result = await db.query(`SELECT 1 FROM users WHERE email = $1`, [email])
    return result.rowCount !== 0
}

export async function updateFullName(id: number, fullName: string): Promise<void> {
    await db.query(`UPDATE users SET full_name = $1 WHERE id = $2`, [fullName, id])
}

export async function usernameExists(username: string): Promise<boolean> {
    const result = await db.query(`SELECT 1 FROM users WHERE username = $1`, [username])
    return result.rowCount !== 0
}

export async function getAllUsers(): Promise<User[]> {
    const result = await db.query(`SELECT * FROM users`)
    return result.rows as User[]
}

export async function updatePassword(id: number, password: string): Promise<void> {
    const hashed = await hashPassword(password)
    await db.query(`UPDATE users SET password = $1 WHERE id = $2`, [hashed, id])
}

export async function deleteUser(id: number): Promise<void> {
    await db.query(`DELETE FROM users WHERE id = $1`, [id])
}