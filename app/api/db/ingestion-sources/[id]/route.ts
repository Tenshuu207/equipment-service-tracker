import { NextRequest, NextResponse } from "next/server"
import { query, hasDb } from "@/lib/db"
import { store } from "@/lib/store"

export const runtime = "nodejs"

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body   = await req.json()
  if (!hasDb()) { store.updateIngestionSource(Number(id), body); return NextResponse.json({ ok: true }) }
  const fields  = Object.keys(body).filter(k => k !== "id" && k !== "created_at")
  const setters = fields.map((k, i) => `${k} = $${i + 2}`).join(", ")
  const values  = fields.map(k => body[k])
  await query(`UPDATE ingestion_sources SET ${setters}, updated_at=now() WHERE id=$1`, [Number(id), ...values])
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!hasDb()) { store.deleteIngestionSource(Number(id)); return NextResponse.json({ ok: true }) }
  await query("DELETE FROM ingestion_sources WHERE id=$1", [Number(id)])
  return NextResponse.json({ ok: true })
}
