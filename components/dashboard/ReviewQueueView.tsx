"use client"

import { useEffect, useRef, useState } from "react"
import {
  fetchReviewQueue,
  submitReview,
  dismissReview,
  fetchImportFiles,
  issueLabel,
  type ReviewRecord,
  type ImportStatus,
  type ImportFile,
} from "@/lib/api"
import {
  ClipboardCheck, AlertTriangle, RefreshCw, CheckCircle2, X, Hash, FileText, Trash2,
} from "lucide-react"

function ConfidenceBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-muted-foreground text-xs">—</span>
  const pct = Math.round(score * 100)
  const color = score >= 0.80 ? "text-emerald-400" : score >= 0.60 ? "text-yellow-400" : "text-warning"
  return (
    <span className={`font-mono text-xs ${color}`}>{pct}%</span>
  )
}

function StatusBadge({ status }: { status: ImportStatus | string }) {
  if (status === "processed")    return <span className="text-xs bg-emerald-900/20 text-emerald-400 px-2 py-0.5 rounded">Processed</span>
  if (status === "needs_review") return <span className="text-xs bg-warning/10 text-warning px-2 py-0.5 rounded">Needs Review</span>
  if (status === "failed")       return <span className="text-xs bg-destructive/10 text-destructive px-2 py-0.5 rounded">Failed</span>
  return <span className="text-xs text-muted-foreground">{status}</span>
}

interface EditState {
  serial_number: string
  equipment_reference: string
  model: string
  review_notes: string
  reviewed_by: string
}

// Defined at module scope — NOT inside any component — so React never remounts it on re-render.
function ReviewField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </div>
  )
}

function ReviewPanel({
  record,
  onClose,
  onSaved,
  onDismissed,
}: {
  record: ReviewRecord
  onClose: () => void
  onSaved: (wo: string) => void
  onDismissed: (wo: string) => void
}) {
  const [form, setForm] = useState<EditState>({
    serial_number:       record.serial_number ?? "",
    equipment_reference: record.equipment_reference ?? "",
    model:               record.model ?? "",
    review_notes:        record.review_notes ?? "",
    reviewed_by:         "",
  })
  const [saving, setSaving] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [importFile, setImportFile] = useState<ImportFile | null>(null)

  // Load the import file record for traceability display
  useEffect(() => {
    fetchImportFiles({ status: "needs_review", limit: 100 }).then(files => {
      const match = files.find(f => f.work_order_no === record.work_order_no)
      if (match) setImportFile(match)
    })
  }, [record.work_order_no])

  function set(k: keyof EditState, v: string) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  async function handleApprove() {
    if (!form.reviewed_by.trim()) {
      setErr("Enter your name before marking as reviewed.")
      return
    }
    setSaving(true)
    try {
      await submitReview(record.work_order_no, {
        serial_number:       form.serial_number  || undefined,
        equipment_reference: form.equipment_reference || undefined,
        model:               form.model          || undefined,
        review_notes:        form.review_notes   || undefined,
        reviewed_by:         form.reviewed_by,
        import_status:       "processed",
      })
      onSaved(record.work_order_no)
    } catch (e) {
      setErr("Failed to save review.")
    } finally {
      setSaving(false)
    }
  }

  async function handleDismiss() {
    if (!window.confirm("Dismiss this record? It will be marked as Failed and removed from the queue.")) return
    setDismissing(true)
    try {
      await dismissReview(record.work_order_no, form.review_notes || "Dismissed by reviewer")
      onDismissed(record.work_order_no)
    } catch {
      setErr("Failed to dismiss record.")
    } finally {
      setDismissing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/60" onClick={onClose} />
      <div className="w-full max-w-xl bg-card border-l border-border flex flex-col overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-border">
          <div>
            <p className="text-[11px] text-muted-foreground uppercase tracking-widest mb-1">Review Record</p>
            <h2 className="text-lg font-mono font-semibold text-foreground">{record.work_order_no}</h2>
            <div className="flex items-center gap-2 mt-1">
              <StatusBadge status={record.import_status} />
              <ConfidenceBadge score={record.parser_confidence} />
              {record.parser_confidence !== null && (
                <span className="text-[11px] text-muted-foreground">parser confidence</span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground mt-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Source info + traceability */}
        <div className="px-6 py-4 border-b border-border bg-secondary/20 space-y-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <p className="text-muted-foreground">Source file: <span className="text-foreground font-mono">{record.file_name ?? record.source_file_name ?? "—"}</span></p>
            <p className="text-muted-foreground">Imported: <span className="text-foreground">{record.imported_at ? new Date(record.imported_at).toLocaleString() : "—"}</span></p>
            <p className="text-muted-foreground">Technician: <span className="text-foreground">{record.technician ?? "—"}</span></p>
            <p className="text-muted-foreground">Date completed: <span className="text-foreground">{record.date_completed ?? "—"}</span></p>
          </div>

          {/* Extended traceability from ImportFile record */}
          {importFile && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs border-t border-border/50 pt-2">
              {importFile.sender && (
                <p className="text-muted-foreground col-span-2">From: <span className="text-foreground">{importFile.sender}</span></p>
              )}
              {importFile.subject && (
                <p className="text-muted-foreground col-span-2">Subject: <span className="text-foreground">{importFile.subject}</span></p>
              )}
              {importFile.attachment_filename && (
                <p className="text-muted-foreground">Attachment: <span className="text-foreground font-mono">{importFile.attachment_filename}</span></p>
              )}
              {importFile.file_hash && (
                <p className="text-muted-foreground flex items-center gap-1">
                  <Hash className="w-3 h-3 shrink-0" />
                  <span className="font-mono truncate">{importFile.file_hash.slice(0, 16)}…</span>
                </p>
              )}
              {importFile.file_path && (
                <p className="text-muted-foreground col-span-2 flex items-center gap-1">
                  <FileText className="w-3 h-3 shrink-0" />
                  <span className="font-mono truncate">{importFile.file_path}</span>
                </p>
              )}
            </div>
          )}

          {/* Routing reason */}
          {record.review_notes && (
            <div className="border-t border-border/50 pt-2">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">Why flagged for review</p>
              <p className="text-xs text-warning bg-warning/10 rounded px-2 py-1 font-mono">{record.review_notes}</p>
            </div>
          )}
          {record.error_message && (
            <p className="text-xs text-warning bg-warning/10 rounded px-2 py-1 font-mono">{record.error_message}</p>
          )}
        </div>

        {/* Editable fields */}
        <div className="flex-1 px-6 py-5 space-y-4">
          <p className="text-xs text-muted-foreground">
            Correct any fields below, then mark as reviewed. Changes are saved to the database.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <ReviewField label="Serial Number"       value={form.serial_number}       onChange={v => set("serial_number", v)} />
            <ReviewField label="Equipment Reference" value={form.equipment_reference} onChange={v => set("equipment_reference", v)} />
            <ReviewField label="Model"               value={form.model}               onChange={v => set("model", v)} />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Review Notes</label>
            <textarea
              value={form.review_notes}
              onChange={e => set("review_notes", e.target.value)}
              rows={3}
              placeholder="Explain any corrections made..."
              className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
          </div>
          <ReviewField label="Your Name (required to approve)" value={form.reviewed_by} onChange={v => set("reviewed_by", v)} />
          {err && <p className="text-xs text-destructive">{err}</p>}
        </div>

        {/* Confidence scale key */}
        <div className="px-6 pb-2">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1.5">Confidence scale</p>
          <div className="flex gap-4 text-[11px]">
            <span className="text-emerald-400">80%+ High — all fields extracted</span>
            <span className="text-yellow-400">65–79% Medium — minor gaps</span>
            <span className="text-warning">Below 65% — needs correction</span>
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 py-4 border-t border-border flex items-center gap-3">
          <button
            onClick={handleApprove}
            disabled={saving || dismissing}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {saving
              ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              : <CheckCircle2 className="w-3.5 h-3.5" />}
            Mark as Reviewed
          </button>
          <button
            onClick={handleDismiss}
            disabled={dismissing || saving}
            className="flex items-center gap-2 px-4 py-2 border border-destructive/40 text-destructive rounded text-sm font-medium hover:bg-destructive/10 disabled:opacity-50"
          >
            {dismissing
              ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              : <Trash2 className="w-3.5 h-3.5" />}
            Dismiss as Failed
          </button>
          <button onClick={onClose} className="ml-auto px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export function ReviewQueueView({ onCountChange }: { onCountChange?: (n: number) => void }) {
  const [records, setRecords] = useState<ReviewRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<ReviewRecord | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  async function load() {
    const data = await fetchReviewQueue()
    setRecords(data)
    onCountChange?.(data.length)
    setLoading(false)
    setRefreshing(false)
  }

  useEffect(() => { load() }, [])

  function removeFromQueue(wo: string) {
    setRecords(prev => {
      const next = prev.filter(r => r.work_order_no !== wo)
      onCountChange?.(next.length)
      return next
    })
    setSelected(null)
  }

  return (
    <>
      {selected && (
        <ReviewPanel
          record={selected}
          onClose={() => setSelected(null)}
          onSaved={removeFromQueue}
          onDismissed={removeFromQueue}
        />
      )}

      <div className="space-y-4">
        {/* Summary */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-4 h-4 text-warning" />
            <span className="text-sm font-medium text-foreground">
              {records.length} record{records.length !== 1 ? "s" : ""} awaiting review
            </span>
          </div>
          <button
            onClick={() => { setRefreshing(true); load() }}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {/* Explanation */}
        <div className="text-xs text-muted-foreground bg-card border border-border rounded px-4 py-3">
          Records are sent here when the parser confidence is below 70% — typically due to a missing serial number, model, or no detected issue codes. Click any row to review and correct.
        </div>

        {/* Table */}
        <div className="bg-card border border-border rounded overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border">
                <tr className="text-[11px] text-muted-foreground uppercase tracking-wider">
                  <th className="text-left py-2 pl-4 pr-4 font-medium">Work Order</th>
                  <th className="text-left py-2 pr-4 font-medium">Source File</th>
                  <th className="text-left py-2 pr-4 font-medium">Serial #</th>
                  <th className="text-left py-2 pr-4 font-medium">Model</th>
                  <th className="text-left py-2 pr-4 font-medium">Date</th>
                  <th className="text-left py-2 pr-4 font-medium">Confidence</th>
                  <th className="text-left py-2 pr-4 font-medium">Imported</th>
                  <th className="text-left py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-muted-foreground text-sm">Loading...</td>
                  </tr>
                ) : records.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <ClipboardCheck className="w-8 h-8 text-emerald-500/50" />
                        <p className="text-sm">Review queue is empty. All imports look good.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  records.map(rec => (
                    <tr
                      key={rec.work_order_no}
                      onClick={() => setSelected(rec)}
                      className="hover:bg-secondary/30 cursor-pointer transition-colors"
                    >
                      <td className="py-3 pl-4 pr-4 font-mono text-primary text-xs">{rec.work_order_no}</td>
                      <td className="py-3 pr-4 text-xs text-muted-foreground font-mono">{rec.file_name ?? rec.source_file_name ?? "—"}</td>
                      <td className="py-3 pr-4 text-xs font-mono">
                        {rec.serial_number
                          ? <span className="text-foreground">{rec.serial_number}</span>
                          : <span className="text-warning">missing</span>}
                      </td>
                      <td className="py-3 pr-4 text-xs">{rec.model ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className="py-3 pr-4 text-xs text-muted-foreground">{rec.date_completed ?? "—"}</td>
                      <td className="py-3 pr-4"><ConfidenceBadge score={rec.parser_confidence} /></td>
                      <td className="py-3 pr-4 text-xs text-muted-foreground">
                        {rec.imported_at ? new Date(rec.imported_at).toLocaleDateString() : "—"}
                      </td>
                      <td className="py-3"><StatusBadge status={rec.import_status} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {records.length > 0 && (
            <div className="px-4 py-2 border-t border-border text-[11px] text-muted-foreground">
              Click a row to open the review panel and correct field values.
            </div>
          )}
        </div>
      </div>
    </>
  )
}
