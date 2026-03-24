import { NextRequest, NextResponse } from "next/server"
import { query, hasDb } from "@/lib/db"
import { store } from "@/lib/store"

export const runtime = "nodejs"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ serial: string }> }) {
  const { serial } = await params
  if (!hasDb()) {
    const asset = store.getAssets().find(a => a.serial_number === serial)
    if (!asset) return NextResponse.json(null)
    const wos = store.getWorkOrders().filter(w => w.serial_number === serial)
    const pm  = wos.filter(w => w.work_order_type === "PM").length
    return NextResponse.json({ ...asset, total_pm_orders: pm, total_w_orders: wos.length - pm, repeat_signatures: null })
  }
  const rows = await query(`
    SELECT
      a.serial_number, a.equipment_reference, a.model, a.status AS asset_status, a.internal_notes,
      c.name AS customer_name,
      COUNT(w.work_order_no)::int                                                    AS total_work_orders,
      COALESCE(SUM(w.total_labor_hours),0)::float                                    AS total_labor_hours,
      MAX(w.date_completed::text)                                                    AS last_service_date,
      COUNT(w.work_order_no) FILTER (WHERE w.problem_note_flag=1)::int              AS problem_count,
      COUNT(w.work_order_no) FILTER (WHERE w.work_order_type='PM')::int             AS total_pm_orders,
      COUNT(w.work_order_no) FILTER (WHERE w.work_order_type='W')::int              AS total_w_orders,
      NULL AS repeat_signatures
    FROM assets a
    LEFT JOIN customers c  ON c.id = a.customer_id
    LEFT JOIN work_orders w ON w.serial_number = a.serial_number AND w.import_status != 'failed'
    WHERE a.serial_number = $1
    GROUP BY a.serial_number, a.equipment_reference, a.model, a.status, a.internal_notes, c.name
  `, [serial])
  return NextResponse.json(rows[0] ?? null)
}
