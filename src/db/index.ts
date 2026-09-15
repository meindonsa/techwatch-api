import { Pool } from '@neondatabase/serverless'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set')
}

export const db = new Pool({ connectionString: DATABASE_URL })

export async function runMigrations() {
    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8')
    const client = await db.connect()
    try {
        await client.query(schema)
        console.log('✅ DB migrations OK')
    } catch (error) {
        console.error('❌ DB migration failed:', error)
        throw error
    } finally {
        client.release()
    }
}