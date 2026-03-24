import { NextResponse } from "next/server"
import { query, hasDb } from "@/lib/db"
import { store } from "@/lib/store"

export const runtime = "nodejs"

export async function GET() {
  if (!hasDb()) return NextResponse.json({ results: store.getProblemAssets() })

  const rows = await query(`
    SELECT
      w.serial_number,
      a.equipment_reference,
      a.model,
      COUNT(DISTINCT w.work_order_no)::int           AS work_order_count,
      COUNT(DISTINCT trim(issue))::int               AS unique_issues,
      string_agg(DISTINCT trim(issue), ',')          AS issue_list,
      MAX(w.date_completed::text)                    AS last_service_date
    FROM work_orders w
    JOIN assets a ON a.serial_number = w.serial_number,
    unnest(string_to_array(COALESCE(w.issues,''), ',')) AS t(issue)
    WHERE w.problem_note_flag = 1
      AND w.serial_number IS NOT NULL
      AND w.import_status != 'failed'
    GROUP BY w.serial_number, a.equipment_reference, a.model
    ORDER BY work_order_count DESC
  `)

  return NextResponse.json({ results: rows })
}
