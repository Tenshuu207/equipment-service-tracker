import { NextResponse } from "next/server"
import { query, hasDb } from "@/lib/db"
import { store } from "@/lib/store"

export const runtime = "nodejs"

export async function GET() {
  if (!hasDb()) {
    return NextResponse.json(store.getImportRuns())
  }
  const rows = await query(`
    SELECT id, started_at, completed_at, files_processed, files_failed, status
    FROM import_runs
    ORDER BY id DESC
    LIMIT 50
  `)
  return NextResponse.json(rows)
}
