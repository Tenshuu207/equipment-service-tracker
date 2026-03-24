/**
 * POST /api/ingest
 *
 * Accepts a parsed work order result from the client and persists it.
 * When DATABASE_URL is set: writes to PostgreSQL.
 * When DATABASE_URL is absent: delegates to the in-memory store (demo mode).
 *
 * Request body (JSON):
 * {
 *   file_name: string
 *   file_hash: string
 *   source_type: string         // .pdf | .msg | .eml
 *   parser_confidence: number
 *   status: "processed" | "needs_review" | "failed"
 *   warnings: string[]
 *   workOrder: WorkOrder | null
 *   // optional email metadata
 *   sender?: string
 *   subject?: string
 *   attachment_filename?: string
 *   sent_date?: string
 * }
 */

import { NextRequest, NextResponse } from "next/server"
import { query, transaction, hasDb } from "@/lib/db"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  const body = await req.json()
  const {
    file_name, file_hash, source_type, parser_confidence, status, workOrder,
    sender, subject, attachment_filename, sent_date,
  } = body

  // ── Demo mode: delegate to in-memory store ────────────────────────────────
  if (!hasDb()) {
    // The client-side DemoUploadPanel already calls store.ingest() directly
    // so this endpoint just acks in demo mode.
    return NextResponse.json({ ok: true, mode: "mock" })
  }

  // ── PostgreSQL write ──────────────────────────────────────────────────────
  try {
    await transaction(async (client) => {

      // 1. Idempotency: skip if same file bytes already processed
      if (file_hash && file_hash !== "") {
        const dup = await client.query(
          "SELECT id FROM import_files WHERE file_hash = $1 AND file_hash != 'seeded'",
          [file_hash]
        )
        if (dup.rows.length > 0) {
          return // same bytes — skip silently
        }
      }

      // 2. Get or create an import run for today
      const runRes = await client.query(`
        INSERT INTO import_runs (started_at, status)
        VALUES (now(), 'running')
        RETURNING id
      `)
      const runId = runRes.rows[0].id

      // 3. Upsert asset if we have a serial number
      const wo = workOrder
      if (wo?.serial_number) {
        await client.query(`
          INSERT INTO assets (serial_number, equipment_reference, model)
          VALUES ($1, $2, $3)
          ON CONFLICT (serial_number) DO UPDATE
            SET equipment_reference = COALESCE($2, assets.equipment_reference),
                model               = COALESCE($3, assets.model)
        `, [wo.serial_number, wo.equipment_reference ?? null, wo.model ?? null])
      }

      // 4. Upsert work order
      if (wo?.work_order_no) {
        // Check for duplicate WO from different file content
        const existingHash = await client.query(
          "SELECT f.file_hash FROM import_files f WHERE f.work_order_no = $1 LIMIT 1",
          [wo.work_order_no]
        )
        const dupHashFlag = existingHash.rows.length > 0 &&
          existingHash.rows[0].file_hash !== file_hash &&
          existingHash.rows[0].file_hash !== "seeded"

        await client.query(`
          INSERT INTO work_orders (
            work_order_no, work_order_type, date_completed, technician,
            serial_number, equipment_reference, model,
            equipment_hours, total_labor_hours,
            service_request_description, repair_action_label, service_performed,
            problem_note_flag, issues, import_status, parser_confidence,
            duplicate_hash_warning, source_file_name, imported_at
          ) VALUES (
            $1,$2,$3::date,$4,
            $5,$6,$7,
            $8,$9,
            $10,$11,$12,
            $13,$14,$15,$16,
            $17,$18,now()
          )
          ON CONFLICT (work_order_no) DO UPDATE SET
            date_completed              = COALESCE($3::date, work_orders.date_completed),
            technician                  = COALESCE($4, work_orders.technician),
            serial_number               = COALESCE($5, work_orders.serial_number),
            equipment_reference         = COALESCE($6, work_orders.equipment_reference),
            model                       = COALESCE($7, work_orders.model),
            equipment_hours             = COALESCE($8, work_orders.equipment_hours),
            total_labor_hours           = COALESCE($9, work_orders.total_labor_hours),
            service_request_description = COALESCE($10, work_orders.service_request_description),
            repair_action_label         = COALESCE($11, work_orders.repair_action_label),
            service_performed           = COALESCE($12, work_orders.service_performed),
            issues                      = COALESCE($14, work_orders.issues),
            import_status               = $15,
            parser_confidence           = $16,
            duplicate_hash_warning      = $17,
            source_file_name            = COALESCE($18, work_orders.source_file_name)
        `, [
          wo.work_order_no, wo.work_order_type ?? null, wo.date_completed ?? null, wo.technician ?? null,
          wo.serial_number ?? null, wo.equipment_reference ?? null, wo.model ?? null,
          wo.equipment_hours ?? null, wo.total_labor_hours ?? null,
          wo.service_request_description ?? null, wo.repair_action_label ?? null, wo.service_performed ?? null,
          wo.problem_note_flag ?? 0, wo.issues ?? null, status, parser_confidence ?? null,
          dupHashFlag ? 1 : 0, file_name,
        ])

        // 5. Update asset issue counts
        if (wo.serial_number && wo.issues) {
          const codes = wo.issues.split(",").map((c: string) => c.trim()).filter(Boolean)
          for (const code of codes) {
            await client.query(`
              INSERT INTO asset_issue_counts (serial_number, issue_code, count)
              VALUES ($1, $2, 1)
              ON CONFLICT (serial_number, issue_code) DO UPDATE
                SET count = asset_issue_counts.count + 1
            `, [wo.serial_number, code])
          }
        }
      }

      // 6. Record import file
      await client.query(`
        INSERT INTO import_files (
          import_run_id, file_name, file_hash, source_type,
          status, work_order_no, parser_confidence,
          sender, subject, attachment_filename, sent_date
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz)
      `, [
        runId, file_name, file_hash || null, source_type ?? null,
        status, wo?.work_order_no ?? null, parser_confidence ?? null,
        sender ?? null, subject ?? null, attachment_filename ?? null,
        sent_date ?? null,
      ])

      // 7. Close the run
      await client.query(`
        UPDATE import_runs
        SET status='completed', completed_at=now(),
            files_processed = files_processed + $2,
            files_failed    = files_failed    + $3
        WHERE id = $1
      `, [runId, status !== "failed" ? 1 : 0, status === "failed" ? 1 : 0])
    })

    return NextResponse.json({ ok: true, mode: "postgres" })

  } catch (err) {
    const msg = err instanceof Error ? err.message : "DB write failed"
    console.error("[ingest]", msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
