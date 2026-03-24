import { NextRequest, NextResponse } from "next/server"
import { query, hasDb } from "@/lib/db"
import { store } from "@/lib/store"

export const runtime = "nodejs"

export async function GET() {
  if (!hasDb()) return NextResponse.json({ results: store.getIngestionSources() })
  const rows = await query(`SELECT * FROM ingestion_sources ORDER BY id`)
  return NextResponse.json({ results: rows })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  if (!hasDb()) return NextResponse.json(store.addIngestionSource(body))
  const rows = await query(`
    INSERT INTO ingestion_sources (name, folder_path, enabled, allowed_types, processed_folder, failed_folder, recursive)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    RETURNING *
  `, [body.name, body.folder_path, body.enabled ?? true, body.allowed_types ?? '.pdf,.eml,.msg',
      body.processed_folder ?? null, body.failed_folder ?? null, body.recursive ?? false])
  return NextResponse.json(rows[0])
}
