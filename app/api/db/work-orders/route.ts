import { NextRequest, NextResponse } from "next/server"
import { query, hasDb } from "@/lib/db"
import { store } from "@/lib/store"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const sp         = req.nextUrl.searchParams
  const technician = sp.get("technician")
  const date_from  = sp.get("date_from")
  const date_to    = sp.get("date_to")
  const issue_code = sp.get("issue_code")
  const serial     = sp.get("serial")

  if (!hasDb()) {
    let results = store.getWorkOrders()
    if (technician) results = results.filter(w => w.technician?.toLowerCase().includes(technician.toLowerCase()))
    if (date_from)  results = results.filter(w => w.date_completed && w.date_completed >= date_from)
    if (date_to)    results = results.filter(w => w.date_completed && w.date_completed <= date_to)
    if (issue_code) results = results.filter(w => w.issues?.includes(issue_code))
    if (serial)     results = results.filter(w => w.serial_number === serial)
    return NextResponse.json({ results })
  }

  const conditions: string[] = []
  const params: unknown[]    = []
  let   i = 1

  if (technician) { conditions.push(`lower(technician) LIKE $${i++}`); params.push(`%${technician.toLowerCase()}%`) }
  if (date_from)  { conditions.push(`date_completed >= $${i++}`);       params.push(date_from) }
  if (date_to)    { conditions.push(`date_completed <= $${i++}`);       params.push(date_to) }
  if (issue_code) { conditions.push(`issues LIKE $${i++}`);             params.push(`%${issue_code}%`) }
  if (serial)     { conditions.push(`serial_number = $${i++}`);         params.push(serial) }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""
  const rows = await query(`
    SELECT work_order_no, work_order_type, date_completed::text, technician,
           serial_number, equipment_reference, model,
           equipment_hours::float, total_labor_hours::float,
           service_request_description, service_performed, repair_action_label,
           problem_note_flag, repeat_asset_key, issues,
           source_file_name, imported_at
    FROM work_orders
    ${where}
    ORDER BY date_completed DESC NULLS LAST, imported_at DESC
    LIMIT 500
  `, params)

  return NextResponse.json({ results: rows })
}
