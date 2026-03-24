/**
 * lib/db.ts — PostgreSQL connection for the Crown Service Equipment Tracker.
 *
 * Uses the `pg` package (node-postgres) which ships with Next.js images.
 * Works identically in Docker (DATABASE_URL from docker-compose) and locally.
 *
 * When DATABASE_URL is absent the db export is null and every API function
 * falls back to the in-memory store — no code change required.
 *
 * Usage in Route Handlers:
 *   import { db } from "@/lib/db"
 *   if (!db) return fallback...
 *   const rows = await db.query("SELECT ...", [param])
 */

import { Pool, type PoolClient } from "pg"

// Re-export a typed query helper so callers don't need to import pg directly.
export interface DbRow {
  [key: string]: unknown
}

let _pool: Pool | null = null

if (process.env.DATABASE_URL) {
  _pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Keep a small pool — this is a single-user internal tool
    max:             5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: process.env.DATABASE_SSL === "true"
      ? { rejectUnauthorized: false }
      : false,
  })

  _pool.on("error", (err) => {
    console.error("[db] Unexpected pool error:", err.message)
  })
}

export const db = _pool

/**
 * Run a single parameterised query and return typed rows.
 * Throws on SQL errors — callers should handle or let Next.js return 500.
 */
export async function query<T extends DbRow = DbRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (!_pool) throw new Error("DATABASE_URL not set — db not available")
  const res = await _pool.query(sql, params)
  return res.rows as T[]
}

/**
 * Run multiple statements in a single transaction.
 * Automatically rolls back on error.
 */
export async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!_pool) throw new Error("DATABASE_URL not set — db not available")
  const client = await _pool.connect()
  try {
    await client.query("BEGIN")
    const result = await fn(client)
    await client.query("COMMIT")
    return result
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    client.release()
  }
}

/**
 * Convenience: return true when a real database is configured.
 */
export function hasDb(): boolean {
  return _pool !== null
}
