import { NextResponse } from "next/server"
import { query, hasDb } from "@/lib/db"
import { store } from "@/lib/store"

export const runtime = "nodejs"

export async function GET() {
  if (!hasDb()) {
    return NextResponse.json(store.getStats())
  }
  const [assets, wos, issues, problems, lastRun] = await Promise.all([
    query("SELECT COUNT(*)::int AS n FROM assets"),
    query("SELECT COUNT(*)::int AS n FROM work_orders WHERE import_status != 'failed'"),
    query("SELECT COALESCE(SUM(count),0)::int AS n FROM asset_issue_counts"),
    query("SELECT COUNT(DISTINCT serial_number)::int AS n FROM work_orders WHERE problem_note_flag = 1"),
    query("SELECT completed_at FROM import_runs ORDER BY id DESC LIMIT 1"),
  ])
  return NextResponse.json({
    total_assets:      assets[0].n,
    total_work_orders: wos[0].n,
    total_issues:      issues[0].n,
    problem_assets:    problems[0].n,
    last_import:       lastRun[0]?.completed_at ?? null,
  })
}
