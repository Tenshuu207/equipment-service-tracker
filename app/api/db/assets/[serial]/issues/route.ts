import { NextRequest, NextResponse } from "next/server"
import { query, hasDb } from "@/lib/db"

export const runtime = "nodejs"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ serial: string }> }) {
  const { serial } = await params
  if (!hasDb()) return NextResponse.json({ results: [] })
  const rows = await query(`
    SELECT trim(issue) AS issue_code, COUNT(*)::int AS count
    FROM work_orders, unnest(string_to_array(COALESCE(issues,''), ',')) AS t(issue)
    WHERE serial_number = $1
      AND issues IS NOT NULL
      AND import_status != 'failed'
    GROUP BY trim(issue)
    ORDER BY count DESC
  `, [serial])
  return NextResponse.json({ results: rows })
}
