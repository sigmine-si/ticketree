import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema.js'

export type Db = ReturnType<typeof createDb>

let pool: pg.Pool | undefined

export function createPool(url = process.env.DATABASE_URL): pg.Pool {
  if (!url) throw new Error('DATABASE_URL is not set')
  pool ??= new pg.Pool({ connectionString: url, max: 10 })
  return pool
}

export function createDb(url?: string) {
  return drizzle(createPool(url), { schema })
}

/** 프로세스 종료 시 커넥션 반납 (러너의 graceful drain에서 쓴다). */
export async function closeDb(): Promise<void> {
  await pool?.end()
  pool = undefined
}

export { schema }
