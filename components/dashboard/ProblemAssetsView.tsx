"use client"

import React, { useEffect, useState } from "react"
import {
  fetchProblemAssets,
  fetchWorkOrders,
  issueLabel,
  type ProblemAsset,
  type WorkOrder,
} from "@/lib/api"
import { AlertTriangle, ChevronDown, ChevronUp, Download, X } from "lucide-react"
import { WOTypeBadge, IssueTags } from "./OverviewView"

// ---------------------------------------------------------------------------
// Inline asset detail slide-out (re-uses the pattern from AssetsView)
// ---------------------------------------------------------------------------
function ProblemAssetDrawer({ asset, onClose }: { asset: ProblemAsset; onClose: () => void }) {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
  const [loading, setLoading] = useState(true)
  const issues = asset.issue_list?.split(",").filter(Boolean) ?? []

  useEffect(() => {
    fetchWorkOrders().then((wos) => {
      setWorkOrders(wos.filter((w) => w.serial_number === asset.serial_number))
      setLoading(false)
    })
  }, [asset.serial_number])

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/60" onClick={onClose} />
      <div className="w-full max-w-2xl bg-card border-l border-border overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-border">
          <div>
            <p className="text-[11px] text-muted-foreground uppercase tracking-widest mb-1">Problem Asset</p>
            <h2 className="text-xl font-mono font-semibold text-foreground">{asset.serial_number}</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {asset.equipment_reference ?? "No ref"} · {asset.model ?? "Unknown model"}
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground mt-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
          {[
            ["Work Orders", asset.work_order_count],
            ["Unique Issues", asset.unique_issues],
            ["Last Service", asset.last_service_date ?? "—"],
          ].map(([label, value]) => (
            <div key={label as string} className="px-4 py-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
              <p className={`text-lg font-mono font-semibold mt-0.5 ${label === "Work Orders" ? "text-warning" : "text-foreground"}`}>
                {value}
              </p>
            </div>
          ))}
        </div>

        {/* Issue tags */}
        <div className="px-6 py-4 border-b border-border">
          <p className="text-[11px] text-muted-foreground uppercase tracking-widest mb-2">Recorded Issue Types</p>
          <div className="flex flex-wrap gap-1.5">
            {issues.map((code) => (
              <span key={code} className="text-xs bg-warning/10 text-warning border border-warning/20 px-2 py-0.5 rounded">
                {issueLabel(code)}
              </span>
            ))}
          </div>
        </div>

        {/* Work order history */}
        <div className="flex-1 p-6">
          <h3 className="text-[11px] uppercase tracking-widest text-muted-foreground mb-4">Work Order History</h3>
          {loading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : workOrders.length === 0 ? (
            <p className="text-muted-foreground text-sm">No work orders found.</p>
          ) : (
            <div className="space-y-3">
              {workOrders.map((wo) => (
                <div key={wo.work_order_no} className="border border-border rounded p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-primary text-sm">{wo.work_order_no}</span>
                      <WOTypeBadge type={wo.work_order_type} />
                      {wo.problem_note_flag === 1 && (
                        <span className="flex items-center gap-1 text-[10px] text-warning bg-warning/10 px-1.5 py-0.5 rounded">
                          <AlertTriangle className="w-3 h-3" /> Problem
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground font-mono">{wo.date_completed}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 text-xs text-muted-foreground">
                    <p>Tech: <span className="text-foreground">{wo.technician ?? "—"}</span></p>
                    <p>Labor hrs: <span className="text-foreground font-mono">{wo.total_labor_hours ?? "—"}</span></p>
                    <p>Equip hrs: <span className="text-foreground font-mono">{wo.equipment_hours ?? "—"}</span></p>
                    <p>Action: <span className="text-foreground">{wo.repair_action_label ?? "—"}</span></p>
                  </div>
                  {wo.service_performed && (
                    <p className="text-xs text-muted-foreground border-t border-border pt-2 leading-relaxed">
                      {wo.service_performed.slice(0, 300)}{wo.service_performed.length > 300 ? "…" : ""}
                    </p>
                  )}
                  {wo.issues && <IssueTags issues={wo.issues} />}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

type SortKey = keyof ProblemAsset

export function ProblemAssetsView() {
  const [assets, setAssets] = useState<ProblemAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>("work_order_count")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [selected, setSelected] = useState<ProblemAsset | null>(null)

  useEffect(() => {
    fetchProblemAssets().then((data) => { setAssets(data); setLoading(false) })
  }, [])

  const sorted = [...assets].sort((a, b) => {
    const aVal = a[sortKey] ?? ""
    const bVal = b[sortKey] ?? ""
    const dir = sortDir === "asc" ? 1 : -1
    return aVal < bVal ? -dir : aVal > bVal ? dir : 0
  })

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortKey(key); setSortDir("desc") }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <span className="ml-1 opacity-0 group-hover:opacity-40"><ChevronDown className="w-3 h-3 inline" /></span>
    return sortDir === "asc"
      ? <ChevronUp className="w-3 h-3 inline ml-1" />
      : <ChevronDown className="w-3 h-3 inline ml-1" />
  }

  const TH = ({ label, col }: { label: string; col?: SortKey }) => (
    <th
      className="group text-left py-2 pr-4 pl-4 text-[11px] text-muted-foreground uppercase tracking-wider font-medium whitespace-nowrap select-none cursor-pointer hover:text-foreground"
      onClick={() => col && toggleSort(col)}
    >
      {label}{col && <SortIcon col={col} />}
    </th>
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
        Loading problem assets...
      </div>
    )
  }

  return (
    <>
      {selected && (
        <ProblemAssetDrawer asset={selected} onClose={() => setSelected(null)} />
      )}

      <div className="space-y-4">
        {/* Summary banner */}
        <div className="flex items-center justify-between gap-3 bg-warning/10 border border-warning/30 rounded px-4 py-3">
          <div className="flex items-center gap-3 text-sm">
            <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
            <span className="text-warning">
              {assets.length} asset{assets.length !== 1 ? "s" : ""} with repeated or flagged service issues — ranked by work order count.
            </span>
          </div>
        </div>

        {assets.length === 0 ? (
          <div className="bg-card border border-border rounded py-16 text-center text-muted-foreground text-sm">
            No problem assets recorded yet.
          </div>
        ) : (
          <div className="bg-card border border-border rounded overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border">
                  <tr>
                    <th className="text-left py-2 pl-4 pr-2 text-[11px] text-muted-foreground font-medium w-8">#</th>
                    <TH label="Serial #"         col="serial_number" />
                    <TH label="Ref"              col="equipment_reference" />
                    <TH label="Model"            col="model" />
                    <TH label="Total WOs"        col="work_order_count" />
                    <TH label="Unique Issues"    col="unique_issues" />
                    <TH label="Last Service"     col="last_service_date" />
                    <th className="text-left py-2 pr-4 text-[11px] text-muted-foreground font-medium">Issue Types</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sorted.map((asset, rank) => {
                    const issues = asset.issue_list?.split(",").filter(Boolean) ?? []

                    return (
                      <tr
                        key={asset.serial_number}
                        onClick={() => setSelected(asset)}
                        className="hover:bg-secondary/40 cursor-pointer transition-colors"
                      >
                        <td className="py-2.5 pl-4 pr-2">
                          <span className={`text-xs font-mono font-semibold ${rank === 0 ? "text-warning" : "text-muted-foreground"}`}>
                            {rank + 1}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4 font-mono text-xs text-primary">{asset.serial_number}</td>
                        <td className="py-2.5 pr-4 text-muted-foreground text-xs">{asset.equipment_reference ?? "—"}</td>
                        <td className="py-2.5 pr-4 text-xs">{asset.model ?? "—"}</td>
                        <td className="py-2.5 pr-4">
                          <div className="flex items-center gap-1.5">
                            <div className="w-16 h-1.5 bg-secondary rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${(asset.work_order_count / (sorted[0]?.work_order_count ?? 1)) * 100}%`,
                                  background: rank === 0 ? "#f59e0b" : "#3b82f6",
                                }}
                              />
                            </div>
                            <span className={`font-mono text-sm font-semibold ${rank === 0 ? "text-warning" : "text-foreground"}`}>
                              {asset.work_order_count}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 pr-4 font-mono text-sm">{asset.unique_issues}</td>
                        <td className="py-2.5 pr-4 text-muted-foreground text-xs">{asset.last_service_date ?? "—"}</td>
                        <td className="py-2.5 pr-4">
                          <div className="flex flex-wrap gap-1">
                            {issues.slice(0, 3).map((code) => (
                              <span key={code} className="text-[10px] bg-secondary text-muted-foreground px-1.5 py-0.5 rounded">
                                {issueLabel(code)}
                              </span>
                            ))}
                            {issues.length > 3 && (
                              <span className="text-[10px] text-muted-foreground">+{issues.length - 3} more</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-border text-[11px] text-muted-foreground">
              {sorted.length} problem asset{sorted.length !== 1 ? "s" : ""} · click a row to open full service history
            </div>
          </div>
        )}
      </div>
    </>
  )
}
