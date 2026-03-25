/**
 * lib/api.ts — Typed API client for the Crown Service Equipment dashboard.
 *
 * In production: set API_BASE_URL to your FastAPI server (e.g. http://localhost:8000)
 * In preview/demo: uses mock data defined below.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || ""

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DashboardStats {
  total_assets: number
  total_work_orders: number
  total_issues: number
  problem_assets: number
  last_import: string | null
}

export interface AssetSummary {
  serial_number: string
  equipment_reference: string | null
  model: string | null
  customer_name: string | null
  total_work_orders: number
  total_labor_hours: number | null
  last_service_date: string | null
  problem_count: number
}

export interface WorkOrder {
  work_order_no: string
  work_order_type: "PM" | "W" | null
  date_completed: string | null
  technician: string | null
  serial_number: string | null
  equipment_reference: string | null
  model: string | null
  equipment_hours: number | null
  total_labor_hours: number | null
  service_request_description: string | null
  service_performed: string | null
  repair_action_label: string | null
  problem_note_flag: number
  repeat_asset_key: string | null
  repeat_issue_signature: string | null
  source_file_name: string | null
  imported_at: string
  issues: string | null
}

export interface IssueFrequency {
  issue_code: string
  count: number
}

export interface IssueByAsset {
  serial_number: string
  equipment_reference: string | null
  issue_code: string
  count: number
}

export interface ProblemAsset {
  serial_number: string
  equipment_reference: string | null
  model: string | null
  work_order_count: number
  unique_issues: number
  issue_list: string | null
  last_service_date: string | null
}

export interface ImportRun {
  id: number
  started_at: string
  completed_at: string | null
  files_processed: number
  files_failed: number
  status: string
}

// v2 types
export type ImportStatus = "processed" | "needs_review" | "failed"

export interface ImportFile {
  id: number
  import_run_id: number
  ingestion_source_id: number | null
  file_name: string
  file_path: string | null
  file_hash: string | null
  status: string
  work_order_no: string | null
  error_message: string | null
  processed_at: string | null
  // joined fields
  source_name: string | null
  subject: string | null
  sender: string | null
  attachment_filename: string | null
}

export interface IngestionSource {
  id: number
  name: string
  folder_path: string
  enabled: boolean
  allowed_types: string
  processed_folder: string | null
  failed_folder: string | null
  recursive: boolean
  created_at: string
  updated_at: string
}

export interface ReviewRecord {
  work_order_no: string
  import_status: ImportStatus
  serial_number: string | null
  equipment_reference: string | null
  model: string | null
  technician: string | null
  date_completed: string | null
  source_file_name: string | null
  imported_at: string
  parser_confidence: number | null
  review_notes: string | null
  file_name: string | null
  error_message: string | null
}

export interface AssetDetail extends AssetSummary {
  total_pm_orders: number
  total_w_orders: number
  repeat_signatures: string | null
}

export interface WorkOrderDetail extends WorkOrder {
  import_status: ImportStatus
  reviewed_by: string | null
  reviewed_at: string | null
  review_notes: string | null
  parser_confidence: number | null
  duplicate_hash_warning: number
}

// ---------------------------------------------------------------------------
// Mock data — delegated entirely to lib/store.ts
// All reads go through store.get*() which returns copies.
// All writes (upload injection) go through store.ingest().
// ---------------------------------------------------------------------------
import { store } from "@/lib/store"

// ---------------------------------------------------------------------------
// Mode detection
// NEXT_PUBLIC_USE_DB=true  → calls the /api/db/* Next.js route handlers
//                            which connect to Postgres when DATABASE_URL is set.
// Otherwise               → in-memory store (demo / v0 preview mode).
// ---------------------------------------------------------------------------

const USE_DB = process.env.NEXT_PUBLIC_USE_DB === "true"

/** Returns true when running in demo/mock mode (no database). */
export function isMockMode(): boolean {
  return !USE_DB
}

/**
 * Internal fetch helper.
 * When USE_DB is true: calls the Next.js /api/db/* route handler.
 *   The route handler then connects to Postgres (or falls back to the
 *   in-memory store if DATABASE_URL is missing on that server instance).
 * When USE_DB is false: returns the mock value directly.
 */
async function apiFetch<T>(path: string, mock: T): Promise<T> {
  if (!USE_DB) return mock

  const base = API_BASE_URL.replace(/\/$/, "")
  const url = `${base}${path}`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`API error ${res.status} on ${url}`)
  return res.json()
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function fetchStats(): Promise<DashboardStats> {
  return apiFetch<DashboardStats>("/api/stats", store.getStats())
}

export async function fetchWorkOrders(params?: {
  date_from?: string; date_to?: string; issue_code?: string; technician?: string; serial?: string
}): Promise<WorkOrder[]> {
  if (!USE_DB) {
    let results = store.getWorkOrders()
    if (params?.technician) results = results.filter(w => w.technician?.toLowerCase().includes(params.technician!.toLowerCase()))
    if (params?.date_from)  results = results.filter(w => w.date_completed && w.date_completed >= params.date_from!)
    if (params?.date_to)    results = results.filter(w => w.date_completed && w.date_completed <= params.date_to!)
    if (params?.issue_code) results = results.filter(w => w.issues?.includes(params.issue_code!))
    if (params?.serial)     results = results.filter(w => w.serial_number?.includes(params.serial!))
    return results
  }

  const cleanParams = Object.fromEntries(
    Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== "")
  )
  const qs = new URLSearchParams(cleanParams as Record<string, string>).toString()
  const path = qs ? `/api/work-orders?${qs}` : "/api/work-orders"
  const data = await apiFetch<{ results: WorkOrder[] }>(path, { results: store.getWorkOrders() })
  return data.results
}

export async function fetchAssets(q: string): Promise<AssetSummary[]> {
  const data = await apiFetch<{ results: AssetSummary[] }>(`/api/db/assets?q=${encodeURIComponent(q)}`, { results: store.getAssets().filter(a => !q || a.serial_number.includes(q)) })
  return data.results
}

export async function fetchAllAssets(query = ""): Promise<AssetSummary[]> {
  if (!USE_DB) return store.getAssets()

  const data = await apiFetch<{ results: AssetSummary[] }>(
    `/api/assets/search?q=${encodeURIComponent(query)}`,
    { results: store.getAssets() }
  )
  return data.results
}

export async function fetchIssueFrequency(params?: { date_from?: string; date_to?: string }): Promise<IssueFrequency[]> {
  if (!USE_DB) return store.getIssueFrequency()

  const cleanParams = Object.fromEntries(
    Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== "")
  )
  const qs = new URLSearchParams(cleanParams as Record<string, string>).toString()
  const path = qs ? `/api/issues/frequency?${qs}` : "/api/issues/frequency"
  const data = await apiFetch<{ results: IssueFrequency[] }>(path, { results: store.getIssueFrequency() })
  return data.results
}

export async function fetchProblemAssets(): Promise<ProblemAsset[]> {
  if (!USE_DB) return store.getProblemAssets()
  const data = await apiFetch<{ results: ProblemAsset[] }>("/api/problem-assets", { results: [] })
  return data.results
}

export async function fetchImportRuns(): Promise<ImportRun[]> {
  return apiFetch<ImportRun[]>("/api/import-runs", store.getImportRuns())
}

export async function fetchTechnicians(): Promise<string[]> {
  if (!USE_DB) {
    const techSet = new Set(store.getWorkOrders().map(w => w.technician).filter(Boolean) as string[])
    return Array.from(techSet).sort()
  }
  const data = await apiFetch<{ technicians: string[] }>("/api/technicians", { technicians: [] })
  return data.technicians
}

export async function fetchIngestionSources(): Promise<IngestionSource[]> {
  return []
}

export async function createIngestionSource(_payload: Partial<IngestionSource>): Promise<IngestionSource> {
  throw new Error("Ingestion source management is not wired to FastAPI yet.")
}

export async function updateIngestionSource(_id: number, _payload: Partial<IngestionSource>): Promise<void> {
  throw new Error("Ingestion source management is not wired to FastAPI yet.")
}

export async function deleteIngestionSource(id: number): Promise<void> {
  if (!USE_DB) { store.deleteIngestionSource(id); return }
  await fetch(`/api/db/ingestion-sources/${id}`, { method: "DELETE" })
}

export async function fetchImportFiles(params?: { run_id?: number; status?: string; limit?: number }): Promise<ImportFile[]> {
  const cleanParams = Object.fromEntries(
    Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== "")
  )
  const qs = new URLSearchParams(cleanParams as Record<string, string>).toString()
  const path = qs ? `/api/import-files?${qs}` : "/api/import-files"
  const data = await apiFetch<{ results: ImportFile[] }>(path, { results: store.getImportFiles() })
  return data.results
}

export async function fetchReviewQueue(): Promise<ReviewRecord[]> {
  return []
}

export async function submitReview(
  _work_order_no: string,
  _updates: Partial<ReviewRecord> & { reviewed_by?: string }
): Promise<void> {
  throw new Error("Review submission is not wired to FastAPI yet.")
}

export async function reprocessFile(_import_file_id: number): Promise<void> {
  // Backend-only — no-op in demo mode
}

export async function dismissReview(
  _work_order_no: string,
  _reason: string
): Promise<void> {
  throw new Error("Review dismissal is not wired to FastAPI yet.")
}

export async function fetchAssetDetail(serial_number: string): Promise<AssetDetail | null> {
  if (!USE_DB) {
    const asset = store.getAssets().find(a => a.serial_number === serial_number)
    if (!asset) return null
    const wos = store.getWorkOrders().filter(w => w.serial_number === serial_number)
    const pm  = wos.filter(w => w.work_order_type === "PM").length
    return { ...asset, total_pm_orders: pm, total_w_orders: wos.length - pm, repeat_signatures: null }
  }
  return apiFetch<AssetDetail | null>(`/api/db/assets/${encodeURIComponent(serial_number)}`, null)
}

export async function fetchWorkOrdersForAsset(serial_number: string): Promise<WorkOrderDetail[]> {
  if (!USE_DB) {
    return store.getWorkOrders()
      .filter(w => w.serial_number === serial_number)
      .map(w => ({ ...w, import_status: "processed" as ImportStatus, reviewed_by: null, reviewed_at: null, review_notes: null, parser_confidence: null, duplicate_hash_warning: 0 }))
  }
  const data = await apiFetch<{ results: WorkOrderDetail[] }>(`/api/work-orders?serial=${encodeURIComponent(serial_number)}`, { results: [] })
  return data.results
}

export async function fetchIssueCountsForAsset(serial_number: string): Promise<IssueFrequency[]> {
  if (!USE_DB) {
    const wos = store.getWorkOrders().filter(w => w.serial_number === serial_number)
    const counts: Record<string, number> = {}
    wos.forEach(w => (w.issues || "").split(",").filter(Boolean).forEach(i => { counts[i] = (counts[i] || 0) + 1 }))
    return Object.entries(counts).map(([issue_code, count]) => ({ issue_code, count })).sort((a, b) => b.count - a.count)
  }
  const data = await apiFetch<{ results: IssueFrequency[] }>(`/api/db/assets/${encodeURIComponent(serial_number)}/issues`, { results: [] })
  return data.results
}

// CSV export helpers (client-side)
export function exportWorkOrdersCSV(workOrders: WorkOrder[]): void {
  const headers = ["work_order_no","work_order_type","date_completed","technician","serial_number","equipment_reference","model","equipment_hours","total_labor_hours","issues","source_file_name","imported_at"]
  const rows = workOrders.map(w => headers.map(h => {
    const val = (w as Record<string, unknown>)[h]
    if (val === null || val === undefined) return ""
    const s = String(val)
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s
  }).join(","))
  const csv = [headers.join(","), ...rows].join("\n")
  _downloadCSV(csv, "work_orders.csv")
}

export function exportAssetsCSV(assets: AssetSummary[]): void {
  const headers = ["serial_number","equipment_reference","model","customer_name","total_work_orders","total_labor_hours","last_service_date","problem_count"]
  const rows = assets.map(a => headers.map(h => {
    const val = (a as Record<string, unknown>)[h]
    return val === null || val === undefined ? "" : String(val)
  }).join(","))
  const csv = [headers.join(","), ...rows].join("\n")
  _downloadCSV(csv, "assets.csv")
}

function _downloadCSV(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// Label helpers
// ---------------------------------------------------------------------------

export function issueLabel(code: string): string {
  const labels: Record<string, string> = {
    // Real codes from Crown service confirmations
    load_wheel:           "Load Wheel",
    guide_wheel:          "Guide / Aisle Wheel",
    drive_wheel:          "Drive Wheel",
    caster_wheel:         "Caster Wheel",
    throttle_controls:    "Throttle / Controls",
    battery_electrical:   "Battery / Electrical",
    floor_platform:       "Floor Pad / Platform",
    load_backrest:        "Load Backrest",
    planned_maintenance:  "Planned Maintenance",
    decommission:         "Decommission / Scrap",
    // Additional codes
    brakes:               "Brakes",
    hydraulics:           "Hydraulics",
    mast:                 "Mast / Chain",
    forks:                "Forks",
    steering:             "Steering",
    lights:               "Lights",
    horn:                 "Horn",
    seat:                 "Seat",
    overhead_guard:       "Overhead Guard",
    charger:              "Charger",
    other:                "Other",
  }
  return labels[code] ?? code.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
}
