"use client"

import { useEffect, useState } from "react"
import { fetchWorkOrders, fetchTechnicians, issueLabel, exportWorkOrdersCSV, type WorkOrder } from "@/lib/api"
import { SlidersHorizontal, AlertTriangle, X, Download } from "lucide-react"
import React from "react"
import { WOTypeBadge, IssueTags } from "./OverviewView"

const ISSUE_OPTIONS = [
  "battery_electrical","hydraulics","general_maintenance","load_wheel","brakes",
  "controller","mast","tires","charger","steering","drive_wheel","caster_wheel",
  "forks","lights","horn","seat","overhead_guard","other",
]

// ---------------------------------------------------------------------------
// Expanded detail row
// ---------------------------------------------------------------------------
function WODetailRow({ wo, onClose }: { wo: WorkOrder; onClose: () => void }) {
  return (
    <tr className="bg-secondary/30 border-b border-border">
      <td colSpan={8} className="px-6 py-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-2">Service Request</p>
            <p className="text-foreground leading-relaxed">
              {wo.service_request_description ?? <span className="text-muted-foreground">Not recorded</span>}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-2">Work Performed</p>
            <p className="text-foreground leading-relaxed">
              {wo.service_performed ?? <span className="text-muted-foreground">Not recorded</span>}
            </p>
          </div>
          <div className="md:col-span-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground pt-2 border-t border-border">
            <span>Action: <span className="text-foreground">{wo.repair_action_label ?? "—"}</span></span>
            <span>Equip hrs: <span className="text-foreground font-mono">{wo.equipment_hours ?? "—"}</span></span>
            <span>Labor hrs: <span className="text-foreground font-mono">{wo.total_labor_hours ?? "—"}</span></span>
            <span>Source: <span className="text-foreground font-mono text-[11px]">{wo.source_file_name ?? "—"}</span></span>
          </div>
        </div>
        <button onClick={onClose} className="absolute right-4 top-4 text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Main WorkOrders View
// ---------------------------------------------------------------------------
export function WorkOrdersView() {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
  const [technicians, setTechnicians] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedWO, setExpandedWO] = useState<string | null>(null)

  // Filters
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [selectedTech, setSelectedTech] = useState("")
  const [selectedIssue, setSelectedIssue] = useState("")
  const [showFilters, setShowFilters] = useState(false)

  useEffect(() => {
    fetchTechnicians().then(setTechnicians)
  }, [])

  useEffect(() => {
    setLoading(true)
    fetchWorkOrders({
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      technician: selectedTech || undefined,
      issue_code: selectedIssue || undefined,
    }).then((wos) => {
      setWorkOrders(wos)
      setLoading(false)
    })
  }, [dateFrom, dateTo, selectedTech, selectedIssue])

  function clearFilters() {
    setDateFrom(""); setDateTo(""); setSelectedTech(""); setSelectedIssue("")
  }

  const hasFilters = dateFrom || dateTo || selectedTech || selectedIssue

  const Select = ({ value, onChange, children }: {
    value: string; onChange: (v: string) => void; children: React.ReactNode
  }) => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-card border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring min-w-36"
    >
      {children}
    </select>
  )

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded border text-sm transition-colors
            ${showFilters ? "bg-primary/10 border-primary/40 text-primary" : "bg-card border-border text-muted-foreground hover:text-foreground"}`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          Filters
          {hasFilters && (
            <span className="ml-1 w-4 h-4 rounded-full bg-primary text-[10px] text-white flex items-center justify-center font-bold">
              {[dateFrom, dateTo, selectedTech, selectedIssue].filter(Boolean).length}
            </span>
          )}
        </button>

        {showFilters && (
          <>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="text-xs">From</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="bg-card border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <span className="text-xs">To</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="bg-card border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <Select value={selectedTech} onChange={setSelectedTech}>
              <option value="">All Technicians</option>
              {technicians.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>

            <Select value={selectedIssue} onChange={setSelectedIssue}>
              <option value="">All Issue Types</option>
              {ISSUE_OPTIONS.map((code) => (
                <option key={code} value={code}>{issueLabel(code)}</option>
              ))}
            </Select>

            {hasFilters && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="w-3 h-3" /> Clear
              </button>
            )}
          </>
        )}

        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{workOrders.length} records</span>
          <button
            onClick={() => exportWorkOrdersCSV(workOrders)}
            disabled={workOrders.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-card border border-border rounded text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr className="text-[11px] text-muted-foreground uppercase tracking-wider">
                <th className="text-left py-2 pr-4 pl-4 font-medium">WO #</th>
                <th className="text-left py-2 pr-4 font-medium">Type</th>
                <th className="text-left py-2 pr-4 font-medium">Date</th>
                <th className="text-left py-2 pr-4 font-medium">Serial</th>
                <th className="text-left py-2 pr-4 font-medium">Ref</th>
                <th className="text-left py-2 pr-4 font-medium">Technician</th>
                <th className="text-left py-2 pr-4 font-medium">Issues</th>
                <th className="text-left py-2 font-medium">Flag</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-muted-foreground">Loading work orders...</td>
                </tr>
              ) : workOrders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-muted-foreground">No work orders match the current filters.</td>
                </tr>
              ) : (
                workOrders.map((wo) => (
                    <React.Fragment key={wo.work_order_no}>
                      <tr
                        onClick={() => setExpandedWO(expandedWO === wo.work_order_no ? null : wo.work_order_no)}
                        className="hover:bg-secondary/40 cursor-pointer transition-colors"
                      >
                        <td className="py-2.5 pr-4 pl-4 font-mono text-primary text-xs">{wo.work_order_no}</td>
                        <td className="py-2.5 pr-4"><WOTypeBadge type={wo.work_order_type} /></td>
                        <td className="py-2.5 pr-4 text-muted-foreground text-xs">{wo.date_completed ?? "—"}</td>
                        <td className="py-2.5 pr-4 font-mono text-xs">{wo.serial_number ?? "—"}</td>
                        <td className="py-2.5 pr-4 text-muted-foreground text-xs">{wo.equipment_reference ?? "—"}</td>
                        <td className="py-2.5 pr-4 text-xs">{wo.technician ?? "—"}</td>
                        <td className="py-2.5 pr-4"><IssueTags issues={wo.issues} /></td>
                        <td className="py-2.5">
                          {wo.problem_note_flag === 1 && (
                            <AlertTriangle className="w-3.5 h-3.5 text-warning" />
                          )}
                        </td>
                      </tr>
                      {expandedWO === wo.work_order_no && (
                        <WODetailRow
                          wo={wo}
                          onClose={() => setExpandedWO(null)}
                        />
                      )}
                    </React.Fragment>
                  ))
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 border-t border-border text-[11px] text-muted-foreground">
          Click a row to expand service details
        </div>
      </div>
    </div>
  )
}
