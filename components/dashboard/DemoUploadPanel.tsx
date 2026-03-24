"use client"

import React, { useCallback, useRef, useState } from "react"
import { parseServiceFile, type ParseResult } from "@/lib/parser"
import { issueLabel } from "@/lib/api"
import { store, sha256, routeByConfidence } from "@/lib/store"
import {
  Upload, FileText, Mail, CheckCircle2, AlertTriangle,
  X, ChevronDown, ChevronUp, RefreshCw, Info,
} from "lucide-react"

interface FileResult {
  file: File
  parse: ParseResult | null
  status: "pending" | "parsing" | "processed" | "needs_review" | "failed"
  error: string | null
  expanded: boolean
}

function FileIcon({ name }: { name: string }) {
  const ext = name.toLowerCase().split(".").pop()
  if (ext === "eml" || ext === "msg") return <Mail className="w-4 h-4 text-primary/70" />
  return <FileText className="w-4 h-4 text-muted-foreground" />
}

function StatusChip({ status }: { status: FileResult["status"] }) {
  if (status === "pending")      return <span className="text-[10px] text-muted-foreground">Pending</span>
  if (status === "parsing")      return <span className="flex items-center gap-1 text-[10px] text-primary"><RefreshCw className="w-2.5 h-2.5 animate-spin" />Parsing</span>
  if (status === "processed")    return <span className="flex items-center gap-1 text-[10px] text-emerald-400"><CheckCircle2 className="w-2.5 h-2.5" />Processed</span>
  if (status === "needs_review") return <span className="flex items-center gap-1 text-[10px] text-warning"><AlertTriangle className="w-2.5 h-2.5" />Needs Review</span>
  if (status === "failed")       return <span className="flex items-center gap-1 text-[10px] text-destructive"><X className="w-2.5 h-2.5" />Failed</span>
  return null
}

function ConfidenceBar({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  const color = score >= 0.8 ? "#34d399" : score >= 0.6 ? "#facc15" : "#f59e0b"
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[11px] font-mono" style={{ color }}>{pct}%</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------
export function DemoUploadPanel({ onImportComplete }: { onImportComplete?: () => void }) {
  const [results, setResults] = useState<FileResult[]>([])
  const [importing, setImporting] = useState(false)
  const [imported, setImported] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Process files ──────────────────────────────────────────────────────────
  async function handleFiles(files: FileList | File[]) {
    const arr = Array.from(files).filter(f =>
      /\.(pdf|eml|msg|txt)$/i.test(f.name)
    )
    if (arr.length === 0) return

    setImported(false)

    // Add to list as pending first
    const newEntries: FileResult[] = arr.map(f => ({
      file: f, parse: null, status: "pending", error: null, expanded: false,
    }))
    setResults(prev => [...prev, ...newEntries])

    // Parse each file
    for (const entry of newEntries) {
      // Mark as parsing
      setResults(prev => prev.map(r =>
        r.file === entry.file ? { ...r, status: "parsing" } : r
      ))

      let parse: ParseResult | null = null
      let status: FileResult["status"] = "failed"
      let error: string | null = null

      try {
        parse = await parseServiceFile(entry.file)
        // Use the authoritative routing rule from store.ts
        status = routeByConfidence(
          parse.workOrder.work_order_no,
          parse.workOrder.serial_number,
          parse.confidence,
          parse.warnings,
        )
      } catch (e) {
        error = e instanceof Error ? e.message : "Parse error"
        status = "failed"
      }

      setResults(prev => prev.map(r =>
        r.file === entry.file ? { ...r, parse, status, error } : r
      ))
    }
  }

  // ── Drag and drop ──────────────────────────────────────────────────────────
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }, [])
  const onDragLeave = useCallback(() => setDragOver(false), [])
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    handleFiles(e.dataTransfer.files)
  }, [])

  // ── Inject into store or Postgres via /api/ingest ────────────────────────
  async function handleImport() {
    setImporting(true)

    const useDb = process.env.NEXT_PUBLIC_USE_DB === "true"

    // Build entries with real SHA-256 hashes
    const entries = await Promise.all(
      results
        .filter(r => r.status !== "pending" && r.status !== "parsing")
        .map(async r => ({
          file:       r.file,
          workOrder:  r.parse?.workOrder ?? null,
          status:     (r.status === "failed" ? "failed" : r.status) as "processed" | "needs_review" | "failed",
          confidence: r.parse?.confidence ?? 0,
          warnings:   r.parse?.warnings ?? (r.error ? [r.error] : []),
          hash:       await sha256(r.file),
        }))
    )

    if (useDb) {
      // Call server-side ingest route — writes directly to Postgres
      await Promise.all(entries.map(e =>
        fetch("/api/ingest", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            file_name:         e.file.name,
            file_hash:         e.hash,
            source_type:       "." + e.file.name.split(".").pop(),
            parser_confidence: e.confidence,
            status:            e.status,
            warnings:          e.warnings,
            workOrder:         e.workOrder,
          }),
        })
      ))
    } else {
      // Demo / mock mode: use in-memory store
      const result = await store.ingest(entries)
      if (result.skipped > 0 || result.flagged > 0) {
        console.info(`[import] runId=${result.runId} ingested=${result.ingested} skipped=${result.skipped} flagged=${result.flagged}`)
      }
    }

    setImporting(false)
    setImported(true)
    onImportComplete?.()
  }

  function toggleExpand(idx: number) {
    setResults(prev => prev.map((r, i) => i === idx ? { ...r, expanded: !r.expanded } : r))
  }
  function removeResult(idx: number) {
    setResults(prev => prev.filter((_, i) => i !== idx))
  }
  function clearAll() {
    setResults([])
    setImported(false)
  }

  const hasParsed  = results.some(r => r.status === "processed" || r.status === "needs_review")
  const allDone    = results.length > 0 && results.every(r => r.status !== "pending" && r.status !== "parsing")

  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-4">
      {/* Info banner */}
      <div className="flex items-start gap-2.5 bg-primary/5 border border-primary/20 rounded px-4 py-3 text-xs text-muted-foreground">
        <Info className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
        <span>
          Drop Crown service confirmation files (.pdf, .msg, .eml).
          {process.env.NEXT_PUBLIC_USE_DB === "true"
            ? " The server extracts PDF text and writes parsed records directly to PostgreSQL. All dashboard views update after import."
            : " Text is extracted server-side via pdf-parse, then parsed in the browser. Records are held in memory until page reload — connect a database for persistence."
          }
        </span>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-lg py-10 px-6 cursor-pointer transition-colors
          ${dragOver
            ? "border-primary bg-primary/5"
            : "border-border bg-card hover:border-primary/40 hover:bg-secondary/30"
          }`}
      >
        <Upload className={`w-7 h-7 ${dragOver ? "text-primary" : "text-muted-foreground"}`} />
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">
            {dragOver ? "Drop files to parse" : "Drop service confirmation files here"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            PDF, EML, MSG, TXT · or click to browse
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.eml,.msg,.txt"
          className="sr-only"
          onChange={e => e.target.files && handleFiles(e.target.files)}
        />
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-3">
          {/* Header row */}
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {results.length} file{results.length !== 1 ? "s" : ""} queued
            </p>
            <button
              onClick={clearAll}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear all
            </button>
          </div>

          {/* File cards */}
          <div className="space-y-2">
            {results.map((r, idx) => (
              <div key={idx} className="bg-card border border-border rounded overflow-hidden">
                {/* Summary row */}
                <div className="flex items-center gap-3 px-4 py-2.5">
                  <FileIcon name={r.file.name} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-mono text-foreground truncate">{r.file.name}</p>
                      {/\.msg$/i.test(r.file.name) && r.status !== "failed" && (
                        <span className="shrink-0 text-[10px] bg-secondary text-muted-foreground px-1.5 py-0.5 rounded">
                          PDF attachment
                        </span>
                      )}
                    </div>
                    {r.parse && r.status !== "failed" && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        WO: <span className="text-foreground font-mono">{r.parse.workOrder.work_order_no}</span>
                        {r.parse.workOrder.serial_number && (
                          <> · S/N: <span className="text-foreground font-mono">{r.parse.workOrder.serial_number}</span></>
                        )}
                        {r.parse.workOrder.model && (
                          <> · <span className="text-foreground">{r.parse.workOrder.model}</span></>
                        )}
                      </p>
                    )}
                    {r.error && (
                      <p className="text-[11px] text-destructive mt-0.5">{r.error}</p>
                    )}
                  </div>
                  <StatusChip status={r.status} />
                  {r.parse && (
                    <button
                      onClick={() => toggleExpand(idx)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {r.expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                  )}
                  <button onClick={() => removeResult(idx)} className="text-muted-foreground hover:text-destructive">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Expanded detail */}
                {r.expanded && r.parse && (
                  <div className="border-t border-border bg-background px-4 py-3 space-y-3">
                    {/* Confidence */}
                    <div className="space-y-1">
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Parser Confidence</p>
                      <ConfidenceBar score={r.parse.confidence} />
                    </div>

                    {/* Extracted fields */}
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                      {[
                        ["Work Order", r.parse.workOrder.work_order_no],
                        ["Type",       r.parse.workOrder.work_order_type ?? "—"],
                        ["Serial #",   r.parse.workOrder.serial_number ?? "—"],
                        ["Equip Ref",  r.parse.workOrder.equipment_reference ?? "—"],
                        ["Model",      r.parse.workOrder.model ?? "—"],
                        ["Technician", r.parse.workOrder.technician ?? "—"],
                        ["Date",       r.parse.workOrder.date_completed ?? "—"],
                        ["Equip Hrs",  r.parse.workOrder.equipment_hours?.toString() ?? "—"],
                        ["Labor Hrs",  r.parse.workOrder.total_labor_hours?.toString() ?? "—"],
                      ].map(([label, val]) => (
                        <div key={label} className="flex gap-1">
                          <span className="text-muted-foreground shrink-0 w-20">{label}:</span>
                          <span className="font-mono text-foreground truncate">{val}</span>
                        </div>
                      ))}
                    </div>

                    {/* Issues */}
                    {r.parse.workOrder.issues && (
                      <div>
                        <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1.5">Detected Issues</p>
                        <div className="flex flex-wrap gap-1.5">
                          {r.parse.workOrder.issues.split(",").filter(Boolean).map(code => (
                            <span key={code} className="text-[10px] bg-secondary text-foreground px-1.5 py-0.5 rounded font-mono">
                              {issueLabel(code)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Warnings */}
                    {r.parse.warnings.length > 0 && (
                      <div>
                        <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">Warnings</p>
                        <ul className="space-y-0.5">
                          {r.parse.warnings.map((w, i) => (
                            <li key={i} className="flex items-center gap-1.5 text-[11px] text-warning">
                              <AlertTriangle className="w-2.5 h-2.5 shrink-0" />{w}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Extraction method + fields found */}
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-[11px] text-muted-foreground">
                        Fields extracted: {r.parse.extractedFields.join(", ") || "none"}
                      </p>
                      {r.parse.warnings.some(w => w.includes("Browser-side"))
                        ? <span className="shrink-0 text-[10px] text-warning bg-warning/10 px-1.5 py-0.5 rounded">browser extraction</span>
                        : <span className="shrink-0 text-[10px] text-emerald-400 bg-emerald-900/20 px-1.5 py-0.5 rounded">server extraction</span>
                      }
                    </div>

                    {/* Raw extracted text preview — helps diagnose .msg parsing */}
                    {r.parse.debugText && (
                      <div>
                        <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">Extracted Text Preview</p>
                        <pre className="text-[10px] font-mono text-muted-foreground bg-background border border-border rounded px-3 py-2 overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">
                          {r.parse.debugText}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Import button */}
          {allDone && hasParsed && !imported && (
            <button
              onClick={handleImport}
              disabled={importing}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary text-primary-foreground rounded text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {importing
                ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Importing...</>
                : <><Upload className="w-3.5 h-3.5" /> Import {results.filter(r => r.status === "processed" || r.status === "needs_review").length} record{results.filter(r => r.status === "processed" || r.status === "needs_review").length !== 1 ? "s" : ""} into dashboard</>
              }
            </button>
          )}

          {imported && (
            <div className="flex items-center gap-2 bg-emerald-900/20 border border-emerald-500/30 text-emerald-400 rounded px-4 py-3 text-sm">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Imported — navigate to Assets, Work Orders, or Issues to see the new records.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
