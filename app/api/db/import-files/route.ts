import { NextRequest, NextResponse } from "next/server"
import { query, hasDb } from "@/lib/db"
import { store } from "@/lib/store"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const sp     = req.nextUrl.searchParams
  const runId  = sp.get("run_id")
  const status = sp.get("status")
  const limit  = parseInt(sp.get("limit") ?? "100")

  if (!hasDb()) {
    let files = store.getImportFiles()
    if (runId)  files = files.filter(f => f.import_run_id === Number(runId))
    if (status) files = files.filter(f => f.status === status)
    return NextResponse.json({ results: files.slice(0, limit) })
  }

  const conditions: string[] = []
  const params: unknown[]    = []
  let i = 1
  if (runId)  { conditions.push(`f.import_run_id = $${i++}`); params.push(Number(runId)) }
  if (status) { conditions.push(`f.status = $${i++}`);        params.push(status) }
  params.push(limit)

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""
  const rows = await query(`
    SELECT
      f.id, f.import_run_id, f.ingestion_source_id,
      f.file_name, f.file_path, f.archived_path, f.file_hash, f.source_type,
      f.status, f.work_order_no, f.error_message,
      f.sender, f.subject, f.attachment_filename, f.sent_date,
      f.duplicate_hash_flag, f.parser_confidence::float,
      f.processed_at,
      s.name AS source_name
    FROM import_files f
    LEFT JOIN ingestion_sources s ON s.id = f.ingestion_source_id
    ${where}
    ORDER BY f.processed_at DESC
    LIMIT $${i}
  `, params)

  return NextResponse.json({ results: rows })
}
