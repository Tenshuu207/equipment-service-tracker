"use client"

import React, { useEffect, useState } from "react"
import {
  fetchImportRuns,
  fetchImportFiles,
  type ImportRun,
  type ImportFile,
} from "@/lib/api"
import {
  CheckCircle, XCircle, Loader, RefreshCw,
  ChevronDown, ChevronUp, Mail, FileText, AlertCircle,
} from "lucide-react"
import { DemoUploadPanel } from "@/components/dashboard/DemoUploadPanel"
import { ParserTestRunner } from "@/components/dashboard/ParserTestRunner"

function RunStatusBadge({ status, failed }: { status: string; failed: number }) {
  if (status === "running") {
    return (
      <span className="flex items-center gap-1.5 text-primary text-xs">
        <Loader className="w-3 h-3 animate-spin" /> Running
      </span>
    )
  }
  if (failed > 0) {
    return (
      <span className="flex items-center gap-1.5 text-warning text-xs">
        <XCircle className="w-3 h-3" /> Completed with errors
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-emerald-400 text-xs">
      <CheckCircle className="w-3 h-3" /> Completed
    </span>
  )
}

function FileStatusBadge({ status }: { status: string }) {
  if (status === "processed")    return <span className="text-[10px] bg-emerald-900/20 text-emerald-400 px-1.5 py-0.5 rounded">Processed</span>
  if (status === "needs_review") return <span className="text-[10px] bg-warning/10 text-warning px-1.5 py-0.5 rounded">Needs Review</span>
  if (status === "failed")       return <span className="text-[10px] bg-destructive/10 text-destructive px-1.5 py-0.5 rounded">Failed</span>
  return <span className="text-[10px] text-muted-foreground">{status}</span>
}

function FileTypeIcon({ name }: { name: string }) {
  const ext = name.toLowerCase().split(".").pop()
  if (ext === "eml" || ext === "msg") return <Mail className="w-3 h-3 text-muted-foreground" />
  return <FileText className="w-3 h-3 text-muted-foreground" />
}

function durationStr(run: ImportRun): string {
  if (!run.completed_at || !run.started_at) return "—"
  const startMs = new Date(run.started_at).getTime()
  const endMs = new Date(run.completed_at).getTime()
  const secs = Math.round((endMs - startMs) / 1000)
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${secs % 60}s`
}

function formatDate(str: string): string {
  return new Date(str).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  })
}

function formatDateShort(str: string): string {
  return new Date(str).toLocaleString("en-US", {
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  })
}

// ---------------------------------------------------------------------------
// Expandable file list for a single run
// ---------------------------------------------------------------------------
function RunFilesPanel({ runId }: { runId: number }) {
  const [files, setFiles] = useState<ImportFile[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchImportFiles({ run_id: runId }).then((data) => {
      setFiles(data)
      setLoading(false)
    })
  }, [runId])

  if (loading) {
    return (
      <tr className="bg-secondary/20 border-b border-border">
        <td colSpan={7} className="px-8 py-3 text-xs text-muted-foreground">Loading files...</td>
      </tr>
    )
  }

  if (files.length === 0) {
    return (
      <tr className="bg-secondary/20 border-b border-border">
        <td colSpan={7} className="px-8 py-3 text-xs text-muted-foreground">No file records for this run.</td>
      </tr>
    )
  }

  return (
    <tr className="bg-secondary/10 border-b border-border">
      <td colSpan={7} className="px-0 py-0">
        <div className="px-6 py-3 space-y-0">
          <p className="text-[11px] text-muted-foreground uppercase tracking-widest mb-2 px-2">Files in this run</p>
          <div className="rounded border border-border divide-y divide-border overflow-hidden">
            {files.map((f) => (
              <div key={f.id} className="flex items-start gap-3 px-3 py-2 text-xs bg-card">
                <FileTypeIcon name={f.file_name} />
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-foreground">{f.file_name}</span>
                    {f.work_order_no && (
                      <span className="text-primary font-mono">{f.work_order_no}</span>
                    )}
                    <FileStatusBadge status={f.status} />
                  </div>
                  {f.subject && (
                    <p className="text-muted-foreground truncate">
                      <span className="text-foreground/50">Subject: </span>{f.subject}
                    </p>
                  )}
                  {f.sender && (
                    <p className="text-muted-foreground truncate">
                      <span className="text-foreground/50">From: </span>{f.sender}
                    </p>
                  )}
                  {f.error_message && (
                    <p className="text-destructive flex items-center gap-1">
                      <AlertCircle className="w-3 h-3 shrink-0" />
                      {f.error_message}
                    </p>
                  )}
                </div>
                {f.processed_at && (
                  <span className="text-muted-foreground text-[11px] shrink-0">{formatDateShort(f.processed_at)}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------
export function ImportHistoryView() {
  const [runs, setRuns] = useState<ImportRun[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [expandedRun, setExpandedRun] = useState<number | null>(null)
  const [showUpload, setShowUpload] = useState(false)

  async function load() {
    const data = await fetchImportRuns()
    setRuns(data)
    setLoading(false)
    setRefreshing(false)
  }

  useEffect(() => { load() }, [])

  function refresh() {
    setRefreshing(true)
    load()
  }

  const totalProcessed = runs.reduce((s, r) => s + r.files_processed, 0)
  const totalFailed = runs.reduce((s, r) => s + r.files_failed, 0)

  return (
    <div className="space-y-4">
      {/* Parser regression test runner */}
      <ParserTestRunner />

      {/* Demo upload panel */}
      <div className="bg-card border border-border rounded overflow-hidden">
        <button
          onClick={() => setShowUpload(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-secondary/30 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">Test File Upload</span>
            <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium tracking-wide uppercase">Demo</span>
          </div>
          {showUpload
            ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
            : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </button>
        {showUpload && (
          <div className="border-t border-border px-4 py-4">
            <DemoUploadPanel
              onImportComplete={() => {
                setShowUpload(false)
                refresh()
              }}
            />
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Import Runs", value: runs.length },
          { label: "Files Processed",   value: totalProcessed },
          { label: "Files Failed",      value: totalFailed, warn: totalFailed > 0 as boolean },
        ].map(({ label, value, warn }) => (
          <div key={label} className="bg-card border border-border rounded px-4 py-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</p>
            <p className={`text-2xl font-mono font-semibold mt-1 ${warn ? "text-warning" : "text-foreground"}`}>
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* Table header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Import Run History
        </h3>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr className="text-[11px] text-muted-foreground uppercase tracking-wider">
                <th className="text-left py-2 pl-4 pr-4 font-medium w-6" />
                <th className="text-left py-2 pr-4 font-medium">Run ID</th>
                <th className="text-left py-2 pr-4 font-medium">Started</th>
                <th className="text-left py-2 pr-4 font-medium">Duration</th>
                <th className="text-center py-2 pr-4 font-medium">Processed</th>
                <th className="text-center py-2 pr-4 font-medium">Failed</th>
                <th className="text-left py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-muted-foreground">Loading import history...</td>
                </tr>
              ) : runs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-muted-foreground">
                    No import runs found. Run the importer to get started.
                  </td>
                </tr>
              ) : (
                runs.map((run) => (
                  <React.Fragment key={run.id}>
                    <tr
                      onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
                      className="hover:bg-secondary/30 cursor-pointer transition-colors"
                    >
                      <td className="py-3 pl-4 pr-2">
                        {expandedRun === run.id
                          ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                          : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                        }
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs text-primary">#{run.id}</td>
                      <td className="py-3 pr-4 text-xs text-muted-foreground">{formatDate(run.started_at)}</td>
                      <td className="py-3 pr-4 font-mono text-xs">{durationStr(run)}</td>
                      <td className="py-3 pr-4 text-center">
                        <span className="font-mono font-semibold text-emerald-400">{run.files_processed}</span>
                      </td>
                      <td className="py-3 pr-4 text-center">
                        <span className={`font-mono font-semibold ${run.files_failed > 0 ? "text-warning" : "text-muted-foreground"}`}>
                          {run.files_failed}
                        </span>
                      </td>
                      <td className="py-3">
                        <RunStatusBadge status={run.status} failed={run.files_failed} />
                      </td>
                    </tr>
                    {expandedRun === run.id && <RunFilesPanel runId={run.id} />}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 border-t border-border text-[11px] text-muted-foreground">
          Click a row to expand file-level details
        </div>
      </div>
    </div>
  )
}
