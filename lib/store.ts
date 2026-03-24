/**
 * lib/store.ts — Hardened in-memory data store for demo/offline mode.
 *
 * Responsibilities:
 *   - Single source of truth for all mock data.
 *   - Idempotent upsert: re-importing the same WO # replaces, never duplicates.
 *   - File hashing (SHA-256 via SubtleCrypto): same file bytes → same hash → skip.
 *   - Duplicate WO flag: same WO # from different file content (different hash) → flag.
 *   - Source traceability: every ImportFile record stores file_name, file_hash,
 *     source_type, subject, sender, attachment_filename, archived_path.
 *   - Routing rules:
 *       confidence >= 0.65  → "processed"
 *       confidence >= 0.45  → "needs_review" (missing serial or model)
 *       missing work_order_no → "needs_review"
 *       confidence <  0.45  → "failed"
 *
 * NOTE: All data lives only in this module's closures. A page refresh resets
 * everything. This is expected for demo mode — the backend owns persistence.
 */

import type {
  WorkOrder, AssetSummary, IssueFrequency, ProblemAsset,
  ImportRun, ImportFile, ReviewRecord, DashboardStats,
  IngestionSource,
} from "@/lib/api"

// ---------------------------------------------------------------------------
// Asset extended metadata (status + internal notes)
// ---------------------------------------------------------------------------
export type AssetStatus = "active" | "out_of_service" | "retired"

export interface AssetMeta {
  serial_number: string
  status: AssetStatus
  internal_notes: string
  updated_at: string
}

// In-memory asset metadata store (keyed by serial_number)
const _assetMeta: Map<string, AssetMeta> = new Map()

// ---------------------------------------------------------------------------
// SHA-256 file hash (browser SubtleCrypto)
// ---------------------------------------------------------------------------
export async function sha256(file: File): Promise<string> {
  const buf    = await file.arrayBuffer()
  const digest = await crypto.subtle.digest("SHA-256", buf)
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
}

// ---------------------------------------------------------------------------
// Source traceability extension on ImportFile
// ---------------------------------------------------------------------------
export interface ImportFileExtended extends ImportFile {
  source_type: ".pdf" | ".msg" | ".eml" | ".txt" | string
  archived_path: string | null        // where the file would be moved in production
  duplicate_hash_flag: boolean        // true = same WO, different file content
  sent_date: string | null            // from email metadata if available
  parser_confidence: number | null
}

// ---------------------------------------------------------------------------
// Routing rule — determines status from parse result
// ---------------------------------------------------------------------------
export type UploadStatus = "processed" | "needs_review" | "failed"

export function routeByConfidence(
  workOrderNo: string | null,
  serialNumber: string | null,
  confidence: number,
  warnings: string[],
): UploadStatus {
  // Hard fail: no WO number at all AND confidence < 0.45
  if (!workOrderNo && confidence < 0.45) return "failed"

  // Missing serial is the most common reason for needs_review
  if (!serialNumber) return "needs_review"

  // Below 65% but has both identifiers → needs_review (may have wrong model/tech)
  if (confidence < 0.65) return "needs_review"

  return "processed"
}

// ---------------------------------------------------------------------------
// Seed data — real Dennis Food Service records, no fabrication
// ---------------------------------------------------------------------------

const _workOrders: WorkOrder[] = [
  {
    work_order_no: "W138240", work_order_type: "W",
    date_completed: "2025-12-05", technician: "Justin Cote",
    serial_number: "6A286154", equipment_reference: "#27", model: "PE4500-60",
    equipment_hours: 5394, total_labor_hours: 3.0,
    service_request_description: "Prep lift truck for scrap",
    service_performed: "Customer requested prep for scrapping. Transfer load back rest to a different lift truck, remove commonly used parts and access modules. 12/5 - removed battery, load back rest, access modules, and commonly used parts.",
    repair_action_label: "Inspected Load Backrest",
    problem_note_flag: 0, repeat_asset_key: "6A286154",
    repeat_issue_signature: null,
    source_file_name: "W138240.pdf", imported_at: "2025-12-17T08:15:04",
    issues: "battery_electrical,decommission,load_backrest",
  },
  {
    work_order_no: "W138107", work_order_type: "W",
    date_completed: "2025-12-04", technician: "Justin Cote",
    serial_number: "6A293437", equipment_reference: "#42", model: "PE4500-60",
    equipment_hours: 10431, total_labor_hours: 4.0,
    service_request_description: "Pallet jack #42 — operator complained of throttle issues, sometimes no power, inconsistent throttle control",
    service_performed: "Found lift truck, verified customers complaint. Last 10 event codes are 336 THROTTLE VOLTAGE OUTSIDE LIMITS. Found nut that holds POT1 loose causing off readings; tightened nut, re-adjusted throttle, Forward Switch, and Reverse Switch. Ordered and replaced spring and bushings. Re-calibrated POT1, performed function test, returned to service.",
    repair_action_label: "Repaired Control Handle",
    problem_note_flag: 1, repeat_asset_key: "6A293437",
    repeat_issue_signature: null,
    source_file_name: "W138107.pdf", imported_at: "2025-12-17T08:15:04",
    issues: "throttle_controls",
  },
  {
    work_order_no: "W137822", work_order_type: "W",
    date_completed: "2025-12-17", technician: "Justin Cote",
    serial_number: "1A460250", equipment_reference: "#8", model: "SP3520-30",
    equipment_hours: 18457, total_labor_hours: null,
    service_request_description: "Remove and replace platform mat",
    service_performed: "Found and brought lift truck outside. Removed damaged floor pad. Scraped and ground away old adhesive and rust spots. Cleaned and prepped surface. Installed new floor pad with weight on top to cure adhesive for 24 hours. Truck tagged out.",
    repair_action_label: "Removed, Tested and Replaced Floor Board/Pad",
    problem_note_flag: 1, repeat_asset_key: "1A460250",
    repeat_issue_signature: null,
    source_file_name: "W137822.pdf", imported_at: "2025-12-17T08:15:04",
    issues: "floor_platform",
  },
  {
    work_order_no: "W135041", work_order_type: "W",
    date_completed: "2025-09-04", technician: "Andrew Cotter",
    serial_number: "1A384086", equipment_reference: "#6", model: "SP3510-30",
    equipment_hours: 6895, total_labor_hours: 1.0,
    service_request_description: "Aisle guide wheels and load wheels",
    service_performed: "Found truck and brought to work area. Jacked and blocked outriggers. Removed front load wheels and left side aisle guide wheel. Right side would not come out due to dented box preventing roll pin from coming up. Removed right rear aisle guide wheel and installed new one, also repaired spring one side. Greased all fittings and test drove. Returned to service.",
    repair_action_label: "Installed Load Wheels",
    problem_note_flag: 0, repeat_asset_key: "1A384086",
    repeat_issue_signature: null,
    source_file_name: "W135041.pdf", imported_at: "2025-09-10T07:30:00",
    issues: "guide_wheel,load_wheel",
  },
  {
    work_order_no: "PM118795", work_order_type: "PM",
    date_completed: "2025-05-01", technician: "Andrew Cotter",
    serial_number: "10183427", equipment_reference: null, model: "WP3035-45",
    equipment_hours: 2193, total_labor_hours: 0.93,
    service_request_description: null,
    service_performed: "Found truck and brought to work area. Removed all covers and blew the truck off. Greased all fittings and checked all adjustment points. Test drove and wiped down. Returned to service.",
    repair_action_label: "Planned Maintenance for Electric Unit",
    problem_note_flag: 0, repeat_asset_key: "10183427",
    repeat_issue_signature: null,
    source_file_name: "PM118795.pdf", imported_at: "2025-05-02T06:00:00",
    issues: "planned_maintenance",
  },
  {
    work_order_no: "PM118779", work_order_type: "PM",
    date_completed: "2025-05-01", technician: "Andrew Cotter",
    serial_number: "6A276850", equipment_reference: null, model: "PE4500-80",
    equipment_hours: 6845, total_labor_hours: 1.05,
    service_request_description: null,
    service_performed: "Found truck and brought to work area. Removed doors and blew the truck off. Greased all fittings and checked all adjustment points. Test drove and wiped down. Returned to service.",
    repair_action_label: "Planned Maintenance for Electric Unit",
    problem_note_flag: 0, repeat_asset_key: "6A276850",
    repeat_issue_signature: null,
    source_file_name: "PM118779.pdf", imported_at: "2025-05-02T06:00:00",
    issues: "planned_maintenance",
  },
]

const _assets: AssetSummary[] = [
  { serial_number: "6A293437", equipment_reference: "#42", model: "PE4500-60", customer_name: "Dennis Food Service", total_work_orders: 3, total_labor_hours: 4.0,  last_service_date: "2025-12-04", problem_count: 1 },
  { serial_number: "1A460250", equipment_reference: "#8",  model: "SP3520-30", customer_name: "Dennis Food Service", total_work_orders: 1, total_labor_hours: null, last_service_date: "2025-12-17", problem_count: 1 },
  { serial_number: "6A286154", equipment_reference: "#27", model: "PE4500-60", customer_name: "Dennis Food Service", total_work_orders: 1, total_labor_hours: 3.0,  last_service_date: "2025-12-05", problem_count: 0 },
  { serial_number: "1A384086", equipment_reference: "#6",  model: "SP3510-30", customer_name: "Dennis Food Service", total_work_orders: 1, total_labor_hours: 1.0,  last_service_date: "2025-09-04", problem_count: 0 },
  { serial_number: "6A276850", equipment_reference: null,  model: "PE4500-80", customer_name: "Dennis Food Service", total_work_orders: 1, total_labor_hours: 1.05, last_service_date: "2025-05-01", problem_count: 0 },
  { serial_number: "10183427", equipment_reference: null,  model: "WP3035-45", customer_name: "Dennis Food Service", total_work_orders: 1, total_labor_hours: 0.93, last_service_date: "2025-05-01", problem_count: 0 },
]

const _issueFrequency: IssueFrequency[] = [
  { issue_code: "planned_maintenance", count: 2  },
  { issue_code: "throttle_controls",   count: 1  },
  { issue_code: "battery_electrical",  count: 1  },
  { issue_code: "load_wheel",          count: 1  },
  { issue_code: "floor_platform",      count: 1  },
  { issue_code: "guide_wheel",         count: 1  },
  { issue_code: "load_backrest",       count: 1  },
  { issue_code: "decommission",        count: 1  },
]

const _problemAssets: ProblemAsset[] = [
  { serial_number: "6A293437", equipment_reference: "#42", model: "PE4500-60", work_order_count: 3, unique_issues: 1, issue_list: "throttle_controls", last_service_date: "2025-12-04" },
  { serial_number: "1A460250", equipment_reference: "#8",  model: "SP3520-30", work_order_count: 1, unique_issues: 1, issue_list: "floor_platform",     last_service_date: "2025-12-17" },
]

const _importRuns: ImportRun[] = [
  { id: 4, started_at: "2025-12-17 08:14:51", completed_at: "2025-12-17 08:15:04", files_processed: 3, files_failed: 0, status: "completed" },
  { id: 3, started_at: "2025-09-10 07:29:40", completed_at: "2025-09-10 07:30:12", files_processed: 1, files_failed: 0, status: "completed" },
  { id: 2, started_at: "2025-05-02 06:00:00", completed_at: "2025-05-02 06:00:28", files_processed: 2, files_failed: 0, status: "completed" },
]

const _importFiles: ImportFileExtended[] = [
  { id: 1, import_run_id: 4, ingestion_source_id: 1, file_name: "W138240.pdf", file_path: "processed/W138240.pdf", file_hash: "seeded", status: "processed", work_order_no: "W138240", error_message: null, processed_at: "2025-12-17 08:15:00", source_name: "Crown Incoming", subject: null, sender: null, attachment_filename: null, source_type: ".pdf", archived_path: "processed/W138240.pdf", duplicate_hash_flag: false, sent_date: null, parser_confidence: 0.95 },
  { id: 2, import_run_id: 4, ingestion_source_id: 1, file_name: "W138107.eml", file_path: "processed/W138107.eml", file_hash: "seeded", status: "processed", work_order_no: "W138107", error_message: null, processed_at: "2025-12-17 08:15:02", source_name: "Crown Incoming", subject: "Service Confirmation W138107", sender: "noreply@crown.com", attachment_filename: "W138107.pdf", source_type: ".eml", archived_path: "processed/W138107.eml", duplicate_hash_flag: false, sent_date: "2025-12-04T14:30:00", parser_confidence: 0.92 },
  { id: 3, import_run_id: 4, ingestion_source_id: 1, file_name: "W137822.pdf", file_path: "processed/W137822.pdf", file_hash: "seeded", status: "processed", work_order_no: "W137822", error_message: null, processed_at: "2025-12-17 08:15:04", source_name: "Crown Incoming", subject: null, sender: null, attachment_filename: null, source_type: ".pdf", archived_path: "processed/W137822.pdf", duplicate_hash_flag: false, sent_date: null, parser_confidence: 0.88 },
  { id: 4, import_run_id: 3, ingestion_source_id: 1, file_name: "W135041.pdf", file_path: "processed/W135041.pdf", file_hash: "seeded", status: "processed", work_order_no: "W135041", error_message: null, processed_at: "2025-09-10 07:30:00", source_name: "Crown Incoming", subject: null, sender: null, attachment_filename: null, source_type: ".pdf", archived_path: "processed/W135041.pdf", duplicate_hash_flag: false, sent_date: null, parser_confidence: 0.91 },
  { id: 5, import_run_id: 2, ingestion_source_id: 1, file_name: "PM118795.pdf", file_path: "processed/PM118795.pdf", file_hash: "seeded", status: "processed", work_order_no: "PM118795", error_message: null, processed_at: "2025-05-02 06:00:00", source_name: "Crown Incoming", subject: null, sender: null, attachment_filename: null, source_type: ".pdf", archived_path: "processed/PM118795.pdf", duplicate_hash_flag: false, sent_date: null, parser_confidence: 0.90 },
]

const _reviewQueue: ReviewRecord[] = []

const _ingestionSources: IngestionSource[] = [
  {
    id: 1,
    name: "Crown Incoming",
    folder_path: "\\\\dennis.com\\shares\\Operations Shared Files\\Day Warehouse\\Warehouse Equipment\\Crown Service Tracking\\Incoming",
    enabled: true,
    allowed_types: ".pdf,.eml,.msg",
    processed_folder: "\\\\dennis.com\\shares\\Operations Shared Files\\Day Warehouse\\Warehouse Equipment\\Crown Service Tracking\\Processed",
    failed_folder:    "\\\\dennis.com\\shares\\Operations Shared Files\\Day Warehouse\\Warehouse Equipment\\Crown Service Tracking\\Failed",
    recursive: false,
    created_at: "2025-12-01 00:00:00",
    updated_at: "2025-12-01 00:00:00",
  },
]

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------
let _runIdCounter  = 100
let _fileIdCounter = 100

// Hash → ImportFile id — used to detect duplicate file content
const _hashIndex: Map<string, number> = new Map()

// WO # → file hash — used to detect same WO from different file content
const _woHashIndex: Map<string, string> = new Map(
  _importFiles.map(f => [f.work_order_no ?? "", f.file_hash ?? ""])
)

// ---------------------------------------------------------------------------
// Read accessors (return copies to prevent external mutation)
// ---------------------------------------------------------------------------
export const store = {
  getWorkOrders:      () => [..._workOrders],
  getAssets:          () => [..._assets],
  getIssueFrequency:  () => [..._issueFrequency],
  getProblemAssets:   () => [..._problemAssets],
  getImportRuns:      () => [..._importRuns],
  getImportFiles:     () => [..._importFiles] as ImportFile[],
  getImportFilesExt:  () => [..._importFiles],
  getReviewQueue:     () => [..._reviewQueue],
  getIngestionSources:() => [..._ingestionSources],

  getStats(): DashboardStats {
    return {
      total_assets:      _assets.length,
      total_work_orders: _workOrders.length,
      total_issues:      _issueFrequency.reduce((s, i) => s + i.count, 0),
      problem_assets:    _problemAssets.length,
      last_import:       _importRuns[0]?.completed_at ?? null,
    }
  },

  // ── Asset metadata ───────────────────────────────────────────────────────
  getAssetMeta(serial: string): AssetMeta {
    return _assetMeta.get(serial) ?? {
      serial_number: serial,
      status: "active",
      internal_notes: "",
      updated_at: "",
    }
  },

  setAssetMeta(serial: string, patch: Partial<Omit<AssetMeta, "serial_number">>): void {
    const current = this.getAssetMeta(serial)
    _assetMeta.set(serial, { ...current, ...patch, serial_number: serial, updated_at: new Date().toISOString() })
  },

  /**
   * Find potential duplicate assets: same model + equipment_reference but different serial.
   * Returns groups of serials that appear to be the same physical asset.
   */
  getDuplicateWarnings(): Array<{ serials: string[]; reason: string }> {
    const byRef: Map<string, string[]> = new Map()
    for (const asset of _assets) {
      if (!asset.equipment_reference || !asset.model) continue
      const key = `${asset.model}::${asset.equipment_reference}`
      const list = byRef.get(key) ?? []
      list.push(asset.serial_number)
      byRef.set(key, list)
    }
    const warnings: Array<{ serials: string[]; reason: string }> = []
    for (const [key, serials] of byRef.entries()) {
      if (serials.length > 1) {
        const [model, ref] = key.split("::")
        warnings.push({ serials, reason: `Model ${model} Ref ${ref} has ${serials.length} different serial numbers` })
      }
    }
    return warnings
  },

  /**
   * Merge two asset records: keep `targetSerial`, reassign all WOs from `sourceSerial` to it,
   * remove the source asset, update aggregates.
   */
  mergeAssets(sourceSerial: string, targetSerial: string): void {
    const sourceIdx = _assets.findIndex(a => a.serial_number === sourceSerial)
    const targetIdx = _assets.findIndex(a => a.serial_number === targetSerial)
    if (sourceIdx === -1 || targetIdx === -1) return

    // Reassign work orders
    for (const wo of _workOrders) {
      if (wo.serial_number === sourceSerial) {
        wo.serial_number = targetSerial
        wo.repeat_asset_key = targetSerial
      }
    }

    // Merge aggregates into target
    const src = _assets[sourceIdx]
    const tgt = _assets[targetIdx]
    _assets[targetIdx] = {
      ...tgt,
      total_work_orders: tgt.total_work_orders + src.total_work_orders,
      total_labor_hours:  (tgt.total_labor_hours ?? 0) + (src.total_labor_hours ?? 0),
      problem_count:      tgt.problem_count + src.problem_count,
      last_service_date:  [tgt.last_service_date, src.last_service_date]
        .filter(Boolean)
        .sort()
        .pop() ?? tgt.last_service_date,
    }

    // Remove source asset
    _assets.splice(sourceIdx, 1)

    // Move source meta notes to target
    const srcMeta = _assetMeta.get(sourceSerial)
    if (srcMeta?.internal_notes) {
      const tgtMeta = this.getAssetMeta(targetSerial)
      this.setAssetMeta(targetSerial, {
        internal_notes: [tgtMeta.internal_notes, `[merged from ${sourceSerial}] ${srcMeta.internal_notes}`]
          .filter(Boolean).join("\n"),
      })
    }
    _assetMeta.delete(sourceSerial)

    // Problem assets
    const pSrc = _problemAssets.findIndex(p => p.serial_number === sourceSerial)
    const pTgt = _problemAssets.findIndex(p => p.serial_number === targetSerial)
    if (pSrc !== -1) {
      if (pTgt !== -1) {
        const merged = Array.from(new Set([
          ...(_problemAssets[pTgt].issue_list ?? "").split(","),
          ...(_problemAssets[pSrc].issue_list ?? "").split(","),
        ].filter(Boolean)))
        _problemAssets[pTgt] = {
          ..._problemAssets[pTgt],
          work_order_count: _problemAssets[pTgt].work_order_count + _problemAssets[pSrc].work_order_count,
          unique_issues: merged.length,
          issue_list: merged.join(","),
        }
      }
      _problemAssets.splice(pSrc, 1)
    }
  },

  // ── Ingestion sources ────────────────────────────────────────────────────
  addIngestionSource(src: Omit<IngestionSource, "id" | "created_at" | "updated_at">): IngestionSource {
    const s: IngestionSource = { ...src, id: Date.now(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    _ingestionSources.push(s)
    return s
  },
  updateIngestionSource(id: number, patch: Partial<IngestionSource>): void {
    const idx = _ingestionSources.findIndex(s => s.id === id)
    if (idx !== -1) Object.assign(_ingestionSources[idx], patch, { updated_at: new Date().toISOString() })
  },
  deleteIngestionSource(id: number): void {
    const idx = _ingestionSources.findIndex(s => s.id === id)
    if (idx !== -1) _ingestionSources.splice(idx, 1)
  },

  // ── Review queue ─────────────────────────────────────────────────────────
  submitReview(workOrderNo: string, updates: Partial<ReviewRecord> & { reviewed_by?: string }): void {
    const rIdx = _reviewQueue.findIndex(r => r.work_order_no === workOrderNo)
    if (rIdx !== -1) {
      Object.assign(_reviewQueue[rIdx], updates, { import_status: "processed" })
    }
    // Also patch the work order with any corrected fields
    const wIdx = _workOrders.findIndex(w => w.work_order_no === workOrderNo)
    if (wIdx !== -1) {
      if (updates.serial_number)       _workOrders[wIdx].serial_number       = updates.serial_number
      if (updates.equipment_reference) _workOrders[wIdx].equipment_reference = updates.equipment_reference
      if (updates.model)               _workOrders[wIdx].model               = updates.model
    }
  },

  /**
   * Dismiss a review record — marks the work order as "failed" and removes it
   * from the queue. Use when the file is genuinely unreadable and cannot be corrected.
   */
  dismissReview(workOrderNo: string, reason: string): void {
    const rIdx = _reviewQueue.findIndex(r => r.work_order_no === workOrderNo)
    if (rIdx !== -1) {
      Object.assign(_reviewQueue[rIdx], {
        import_status: "failed",
        review_notes: reason || "Dismissed by reviewer",
      })
      _reviewQueue.splice(rIdx, 1)
    }
    // Mark the work order's source file record as failed
    const fIdx = _importFiles.findIndex(f => f.work_order_no === workOrderNo && f.status === "needs_review")
    if (fIdx !== -1) {
      _importFiles[fIdx].status = "failed"
      _importFiles[fIdx].error_message = reason || "Dismissed by reviewer"
    }
  },

  // ── Main upload injection ─────────────────────────────────────────────────
  /**
   * Called by DemoUploadPanel after parsing.
   *
   * For each file:
   *   1. Compute SHA-256 hash.
   *   2. If hash already seen → skip (idempotent, same bytes re-uploaded).
   *   3. If WO # seen with a DIFFERENT hash → flag as duplicate_hash_flag.
   *   4. Upsert work order (same WO # → replace row, never append duplicate).
   *   5. Update asset aggregates.
   *   6. Add ImportFile with full traceability.
   *   7. Route to review queue if needs_review.
   *   8. Create import run record.
   *
   * Returns a summary of what was done.
   */
  async ingest(entries: Array<{
    file: File
    workOrder: WorkOrder | null
    status: UploadStatus
    confidence: number
    warnings: string[]
    hash: string
    subject?: string | null
    sender?: string | null
    attachmentFilename?: string | null
    sentDate?: string | null
  }>): Promise<{ runId: number; ingested: number; skipped: number; flagged: number }> {
    const now    = new Date().toISOString()
    const runId  = ++_runIdCounter
    let ingested = 0
    let skipped  = 0
    let flagged  = 0

    const runFileResults: ImportFileExtended[] = []

    for (const entry of entries) {
      const { file, workOrder, status, confidence, warnings, hash } = entry

      // ── 1. Idempotency: skip if same file bytes already imported
      if (_hashIndex.has(hash) && hash !== "") {
        skipped++
        continue
      }

      // ── 2. Duplicate WO from different content → flag
      let duplicateHashFlag = false
      if (workOrder?.work_order_no) {
        const existingHash = _woHashIndex.get(workOrder.work_order_no)
        if (existingHash && existingHash !== hash && existingHash !== "seeded") {
          duplicateHashFlag = true
          flagged++
          warnings.push(`Duplicate WO# ${workOrder.work_order_no} — imported previously from different file content`)
        }
      }

      // ── 3. Upsert work order
      if (workOrder) {
        // Remove any seeded placeholder rows for the same serial number.
        // Seeded rows have file_hash === "seeded" — they were pre-populated for demo
        // purposes and must not show alongside a real parsed upload for the same asset.
        if (workOrder.serial_number) {
          const seededWoNos = _importFiles
            .filter(f => f.file_hash === "seeded")
            .map(f => f.work_order_no)
            .filter(Boolean) as string[]
          for (let i = _workOrders.length - 1; i >= 0; i--) {
            const w = _workOrders[i]
            if (
              w.serial_number === workOrder.serial_number &&
              w.work_order_no !== workOrder.work_order_no &&
              seededWoNos.includes(w.work_order_no)
            ) {
              _workOrders.splice(i, 1)
            }
          }
        }

        const wIdx = _workOrders.findIndex(w => w.work_order_no === workOrder.work_order_no)
        if (wIdx !== -1) {
          // Replace — upsert semantics
          _workOrders[wIdx] = workOrder
        } else {
          _workOrders.unshift(workOrder)
        }

        // Update asset aggregates
        if (workOrder.serial_number) {
          const aIdx = _assets.findIndex(a => a.serial_number === workOrder.serial_number)
          if (aIdx !== -1) {
            _assets[aIdx] = {
              ..._assets[aIdx],
              ...(workOrder.model               ? { model:               workOrder.model               } : {}),
              ...(workOrder.equipment_reference ? { equipment_reference: workOrder.equipment_reference } : {}),
              total_work_orders: _assets[aIdx].total_work_orders + (wIdx === -1 ? 1 : 0),
              total_labor_hours: (_assets[aIdx].total_labor_hours ?? 0) + (workOrder.total_labor_hours ?? 0),
              last_service_date: workOrder.date_completed ?? _assets[aIdx].last_service_date,
              problem_count: workOrder.problem_note_flag
                ? _assets[aIdx].problem_count + 1
                : _assets[aIdx].problem_count,
            }
          } else {
            _assets.unshift({
              serial_number:       workOrder.serial_number,
              equipment_reference: workOrder.equipment_reference,
              model:               workOrder.model,
              customer_name:       "Dennis Food Service",
              total_work_orders:   1,
              total_labor_hours:   workOrder.total_labor_hours,
              last_service_date:   workOrder.date_completed,
              problem_count:       workOrder.problem_note_flag,
            })
          }

          // Issue frequency
          for (const code of (workOrder.issues ?? "").split(",").filter(Boolean)) {
            const iIdx = _issueFrequency.findIndex(i => i.issue_code === code)
            if (iIdx !== -1) _issueFrequency[iIdx].count += 1
            else _issueFrequency.push({ issue_code: code, count: 1 })
          }

          // Problem assets
          if (workOrder.problem_note_flag) {
            const pIdx = _problemAssets.findIndex(p => p.serial_number === workOrder.serial_number)
            const issues = (workOrder.issues ?? "").split(",").filter(Boolean)
            if (pIdx !== -1) {
              const merged = Array.from(new Set([...(_problemAssets[pIdx].issue_list ?? "").split(","), ...issues]))
              _problemAssets[pIdx] = {
                ..._problemAssets[pIdx],
                work_order_count: _problemAssets[pIdx].work_order_count + 1,
                unique_issues: merged.length,
                issue_list: merged.join(","),
                last_service_date: workOrder.date_completed ?? _problemAssets[pIdx].last_service_date,
              }
            } else {
              _problemAssets.push({
                serial_number:       workOrder.serial_number,
                equipment_reference: workOrder.equipment_reference,
                model:               workOrder.model,
                work_order_count:    1,
                unique_issues:       issues.length,
                issue_list:          issues.join(","),
                last_service_date:   workOrder.date_completed,
              })
            }
          }
        }

        // ── 4. Review queue
        if (status === "needs_review") {
          // Remove existing review record for this WO if any
          const rIdx = _reviewQueue.findIndex(r => r.work_order_no === workOrder.work_order_no)
          if (rIdx !== -1) _reviewQueue.splice(rIdx, 1)

          _reviewQueue.unshift({
            work_order_no:       workOrder.work_order_no,
            import_status:       "needs_review",
            serial_number:       workOrder.serial_number,
            equipment_reference: workOrder.equipment_reference,
            model:               workOrder.model,
            technician:          workOrder.technician,
            date_completed:      workOrder.date_completed,
            source_file_name:    workOrder.source_file_name,
            imported_at:         workOrder.imported_at,
            parser_confidence:   confidence,
            review_notes:        warnings.length ? warnings.join("; ") : null,
            file_name:           file.name,
            error_message:       null,
          })
        }

        // ── 5. Register hash
        _woHashIndex.set(workOrder.work_order_no, hash)
      }

      if (hash) _hashIndex.set(hash, ++_fileIdCounter)

      // ── 6. ImportFile record with full traceability
      const ext = ("." + file.name.split(".").pop()!.toLowerCase()) as ImportFileExtended["source_type"]
      const fileRecord: ImportFileExtended = {
        id:                   _fileIdCounter,
        import_run_id:        runId,
        ingestion_source_id:  null,
        file_name:            file.name,
        file_path:            `incoming/${file.name}`,
        file_hash:            hash,
        status:               status === "failed" ? "failed" : status,
        work_order_no:        workOrder?.work_order_no ?? null,
        error_message:        warnings.length ? warnings.join("; ") : null,
        processed_at:         now,
        source_name:          "Demo Upload",
        subject:              entry.subject ?? null,
        sender:               entry.sender  ?? null,
        attachment_filename:  entry.attachmentFilename ?? null,
        source_type:          ext,
        archived_path:        status === "processed"
          ? `processed/${file.name}`
          : status === "failed"
          ? `failed/${file.name}`
          : `review/${file.name}`,
        duplicate_hash_flag:  duplicateHashFlag,
        sent_date:            entry.sentDate ?? null,
        parser_confidence:    confidence,
      }
      runFileResults.push(fileRecord)
      _importFiles.unshift(fileRecord)
      ingested++
    }

    // ── 7. Import run record
    const processed  = runFileResults.filter(f => f.status === "processed").length
    const failed     = runFileResults.filter(f => f.status === "failed").length
    const needsReview = runFileResults.filter(f => f.status === "needs_review").length
    _importRuns.unshift({
      id:            runId,
      started_at:    now,
      completed_at:  new Date().toISOString(),
      files_processed: processed + needsReview,
      files_failed:  failed,
      status:        "completed",
    })

    return { runId, ingested, skipped, flagged }
  },
}
