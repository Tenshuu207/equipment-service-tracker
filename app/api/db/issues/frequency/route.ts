import { NextRequest, NextResponse } from "next/server"
import { query, hasDb } from "@/lib/db"
import { store } from "@/lib/store"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const sp        = req.nextUrl.searchParams
  const date_from = sp.get("date_from")
  const date_to   = sp.get("date_to")

  if (!hasDb()) return NextResponse.json({ results: store.getIssueFrequency() })

  const conditions: string[] = ["issues IS NOT NULL", "import_status != 'failed'"]
  const params: unknown[]    = []
  let i = 1
  if (date_from) { conditions.push(`date_completed >= $${i++}`); params.push(date_from) }
  if (date_to)   { conditions.push(`date_completed <= $${i++}`); params.push(date_to) }

  const where = `WHERE ${conditions.join(" AND ")}`

  // Explode comma-separated issues column into individual rows
  const rows = await query(`
    SELECT trim(issue) AS issue_code, COUNT(*)::int AS count
    FROM work_orders, unnest(string_to_array(issues, ',')) AS t(issue)
    ${where}
    GROUP BY trim(issue)
    ORDER BY count DESC
  `, params)

  return NextResponse.json({ results: rows })
}
