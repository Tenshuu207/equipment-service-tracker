import { NextRequest, NextResponse } from "next/server"
import { query, hasDb } from "@/lib/db"
import { store } from "@/lib/store"

export const runtime = "nodejs"

export async function GET() {
  if (!hasDb()) {
    return NextResponse.json({ results: store.getReviewQueue() })
  }
  const rows = await query(`
    SELECT
      w.work_order_no,
      w.import_status,
      w.serial_number,
      w.equipment_reference,
      w.model,
      w.technician,
      w.date_completed::text,
      w.source_file_name,
      w.imported_at,
      w.parser_confidence::float,
      w.review_notes,
      f.file_name,
      f.error_message,
      f.sender,
      f.subject,
      f.attachment_filename,
      f.file_hash,
      f.archived_path
    FROM work_orders w
    LEFT JOIN import_files f ON f.work_order_no = w.work_order_no
    WHERE w.import_status = 'needs_review'
    ORDER BY w.imported_at DESC
  `)
  return NextResponse.json({ results: rows })
}

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { work_order_no, serial_number, equipment_reference, model,
          review_notes, reviewed_by, action } = body

  if (action === "dismiss") {
    if (!hasDb()) { store.dismissReview(work_order_no, review_notes ?? "Dismissed"); return NextResponse.json({ ok: true }) }
    await query(`
      UPDATE work_orders
      SET import_status='failed', review_notes=$2, reviewed_by=$3, reviewed_at=now()
      WHERE work_order_no=$1
    `, [work_order_no, review_notes ?? "Dismissed", reviewed_by ?? null])
    await query(`UPDATE import_files SET status='failed', error_message=$2 WHERE work_order_no=$1 AND status='needs_review'`, [work_order_no, review_notes])
    return NextResponse.json({ ok: true })
  }

  // approve
  if (!hasDb()) { store.submitReview(work_order_no, { serial_number, equipment_reference, model, review_notes, reviewed_by }); return NextResponse.json({ ok: true }) }
  await query(`
    UPDATE work_orders
    SET import_status='processed',
        serial_number        = COALESCE($2, serial_number),
        equipment_reference  = COALESCE($3, equipment_reference),
        model                = COALESCE($4, model),
        review_notes         = $5,
        reviewed_by          = $6,
        reviewed_at          = now()
    WHERE work_order_no = $1
  `, [work_order_no, serial_number || null, equipment_reference || null, model || null, review_notes || null, reviewed_by || null])

  // Ensure asset row exists
  if (serial_number) {
    await query(`INSERT INTO assets (serial_number, equipment_reference, model) VALUES ($1,$2,$3) ON CONFLICT (serial_number) DO UPDATE SET equipment_reference=COALESCE($2,assets.equipment_reference), model=COALESCE($3,assets.model)`,
      [serial_number, equipment_reference || null, model || null])
  }

  return NextResponse.json({ ok: true })
}
