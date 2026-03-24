import { NextResponse } from "next/server"
import { query, hasDb } from "@/lib/db"
import { store } from "@/lib/store"

export const runtime = "nodejs"

export async function GET() {
  if (!hasDb()) {
    const techSet = new Set(store.getWorkOrders().map(w => w.technician).filter(Boolean) as string[])
    return NextResponse.json({ technicians: Array.from(techSet).sort() })
  }
  const rows = await query(`
    SELECT DISTINCT technician FROM work_orders
    WHERE technician IS NOT NULL
    ORDER BY technician
  `)
  return NextResponse.json({ technicians: rows.map(r => r.technician) })
}
