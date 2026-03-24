import { NextRequest, NextResponse } from "next/server"
import { query, hasDb } from "@/lib/db"
import { store } from "@/lib/store"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? ""

  if (!hasDb()) {
    const ql = q.toLowerCase()
    const results = store.getAssets().filter(a =>
      !q ||
      a.serial_number.toLowerCase().includes(ql) ||
      a.equipment_reference?.toLowerCase().includes(ql) ||
      a.model?.toLowerCase().includes(ql)
    )
    return NextResponse.json({ results })
  }

  const params: unknown[] = []
  let where = ""
  if (q) {
    where = `WHERE a.serial_number ILIKE $1 OR a.equipment_reference ILIKE $1 OR a.model ILIKE $1`
    params.push(`%${q}%`)
  }

  const rows = await query(`
    SELECT
      a.serial_number,
      a.equipment_reference,
      a.model,
      c.name          AS customer_name,
      a.status        AS asset_status,
      a.internal_notes,
      COUNT(w.work_order_no)::int                                AS total_work_orders,
      COALESCE(SUM(w.total_labor_hours),0)::float                AS total_labor_hours,
      MAX(w.date_completed::text)                                AS last_service_date,
      COUNT(w.work_order_no) FILTER (WHERE w.problem_note_flag=1)::int AS problem_count
    FROM assets a
    LEFT JOIN customers c  ON c.id = a.customer_id
    LEFT JOIN work_orders w ON w.serial_number = a.serial_number
      AND w.import_status != 'failed'
    ${where}
    GROUP BY a.serial_number, a.equipment_reference, a.model, c.name, a.status, a.internal_notes
    ORDER BY MAX(w.date_completed) DESC NULLS LAST
  `, params)

  return NextResponse.json({ results: rows })
}
