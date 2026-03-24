"use client"

import { useEffect, useState, useRef } from "react"
import {
  fetchAllAssets,
  fetchAssets,
  fetchWorkOrders,
  exportAssetsCSV,
  issueLabel,
  type AssetSummary,
  type WorkOrder,
} from "@/lib/api"
import {
  store,
  type AssetMeta,
  type AssetStatus,
} from "@/lib/store"
import {
  Search, ChevronDown, ChevronUp, AlertTriangle, Download,
  GitMerge, Settings, X, CheckCircle2, RefreshCw,
} from "lucide-react"
import { WOTypeBadge, IssueTags } from "./OverviewView"

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------
function AssetStatusBadge({ status }: { status: AssetStatus }) {
  if (status === "active")
    return <span className="text-[10px] bg-emerald-900/20 text-emerald-400 px-1.5 py-0.5 rounded">Active</span>
  if (status === "out_of_service")
    return <span className="text-[10px] bg-warning/10 text-warning px-1.5 py-0.5 rounded">Out of Service</span>
  return <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">Retired</span>
}

// ---------------------------------------------------------------------------
// Asset management panel (status + notes, shown as a side sheet)
// ---------------------------------------------------------------------------
function AssetManagePanel({
  serial,
  onClose,
  onSaved,
}: {
  serial: string
  onClose: () => void
  onSaved: () => void
}) {
  const meta = store.getAssetMeta(serial)
  const [status, setStatus] = useState<AssetStatus>(meta.status)
  const [notes, setNotes] = useState(meta.internal_notes)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  function handleSave() {
    setSaving(true)
    store.setAssetMeta(serial, { status, internal_notes: notes })
    setSaving(false)
    setSaved(true)
    setTimeout(() => { setSaved(false); onSaved() }, 800)
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/60" onClick={onClose} />
      <div className="w-full max-w-sm bg-card border-l border-border flex flex-col">
        <div className="flex items-start justify-between px-5 py-4 border-b border-border">
          <div>
            <p className="text-[11px] text-muted-foreground uppercase tracking-widest">Asset Settings</p>
            <p className="font-mono text-base font-semibold text-foreground mt-0.5">{serial}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground mt-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 px-5 py-5 space-y-5">
          <div className="space-y-2">
            <label className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Status</label>
            <div className="flex flex-col gap-2">
              {(["active", "out_of_service", "retired"] as AssetStatus[]).map(s => (
                <label
                  key={s}
                  className={`flex items-center gap-3 px-3 py-2 rounded border cursor-pointer transition-colors
                    ${status === s
                      ? "border-primary/50 bg-primary/5 text-foreground"
                      : "border-border bg-background text-muted-foreground hover:border-border/80"}`}
                >
                  <input
                    type="radio"
                    name="status"
                    value={s}
                    checked={status === s}
                    onChange={() => setStatus(s)}
                    className="accent-primary"
                  />
                  <AssetStatusBadge status={s} />
                  <span className="text-xs">
                    {s === "active" ? "In regular service" :
                     s === "out_of_service" ? "Temporarily offline" :
                     "Permanently decommissioned"}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Internal Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={5}
              placeholder="e.g. Flagged for battery replacement next PM cycle..."
              className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-border flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving || saved}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium hover:bg-primary/90 disabled:opacity-60"
          >
            {saved
              ? <><CheckCircle2 className="w-3.5 h-3.5" /> Saved</>
              : saving
              ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Saving...</>
              : "Save Changes"}
          </button>
          <button onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Merge confirmation modal
// ---------------------------------------------------------------------------
function MergeModal({
  group,
  allAssets,
  onClose,
  onMerged,
}: {
  group: { serials: string[]; reason: string }
  allAssets: AssetSummary[]
  onClose: () => void
  onMerged: () => void
}) {
  const [targetSerial, setTargetSerial] = useState(group.serials[0])
  const [done, setDone] = useState(false)

  function handleMerge() {
    for (const s of group.serials) {
      if (s !== targetSerial) {
        store.mergeAssets(s, targetSerial)
      }
    }
    setDone(true)
    setTimeout(() => { onMerged(); onClose() }, 600)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-lg w-full max-w-md p-5 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] text-muted-foreground uppercase tracking-widest mb-1">Merge Duplicate Assets</p>
            <p className="text-sm text-foreground">{group.reason}</p>
          </div>
          <button onClick={onClose}><X className="w-4 h-4 text-muted-foreground hover:text-foreground" /></button>
        </div>

        <div className="text-xs text-warning bg-warning/10 rounded px-3 py-2">
          All work orders from the source serial(s) will be reassigned to the target. The source record will be removed. This cannot be undone in demo mode.
        </div>

        <div className="space-y-2">
          <label className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Keep this serial as the master record</label>
          {group.serials.map(s => {
            const asset = allAssets.find(a => a.serial_number === s)
            return (
              <label
                key={s}
                className={`flex items-center gap-3 px-3 py-2 rounded border cursor-pointer transition-colors
                  ${targetSerial === s
                    ? "border-primary/50 bg-primary/5"
                    : "border-border bg-background hover:border-border/80"}`}
              >
                <input
                  type="radio"
                  name="merge_target"
                  value={s}
                  checked={targetSerial === s}
                  onChange={() => setTargetSerial(s)}
                  className="accent-primary"
                />
                <span className="font-mono text-xs text-foreground">{s}</span>
                <span className="text-xs text-muted-foreground">{asset?.model ?? ""} · {asset?.total_work_orders ?? 0} WOs</span>
              </label>
            )
          })}
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleMerge}
            disabled={done}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium hover:bg-primary/90 disabled:opacity-60"
          >
            {done
              ? <><CheckCircle2 className="w-3.5 h-3.5" /> Merged</>
              : <><GitMerge className="w-3.5 h-3.5" /> Merge Records</>}
          </button>
          <button onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground">Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Asset detail drawer
// ---------------------------------------------------------------------------
function AssetDetail({
  asset,
  onClose,
  onOpenManage,
}: {
  asset: AssetSummary
  onClose: () => void
  onOpenManage: (serial: string) => void
}) {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
  const [loading, setLoading] = useState(true)
  const meta = store.getAssetMeta(asset.serial_number)

  useEffect(() => {
    fetchWorkOrders().then((wos) => {
      setWorkOrders(wos.filter((w) => w.serial_number === asset.serial_number))
      setLoading(false)
    })
  }, [asset.serial_number])

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/60" onClick={onClose} />
      <div className="w-full max-w-2xl bg-card border-l border-border overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-border">
          <div>
            <p className="text-[11px] text-muted-foreground uppercase tracking-widest mb-1">Asset Detail</p>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-mono font-semibold text-foreground">{asset.serial_number}</h2>
              <AssetStatusBadge status={meta.status} />
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {asset.equipment_reference ?? "—"} · {asset.model ?? "—"} · {asset.customer_name}
            </p>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <button
              onClick={() => onOpenManage(asset.serial_number)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border border-border rounded text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
            >
              <Settings className="w-3 h-3" />
              Manage
            </button>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 divide-x divide-border border-b border-border">
          {[
            ["Work Orders", asset.total_work_orders],
            ["Labor Hours", asset.total_labor_hours?.toFixed(1) ?? "—"],
            ["Last Service", asset.last_service_date ?? "—"],
            ["Problem Flags", asset.problem_count],
          ].map(([label, value]) => (
            <div key={label as string} className="px-4 py-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
              <p className={`text-lg font-mono font-semibold mt-0.5 ${label === "Problem Flags" && Number(value) > 0 ? "text-warning" : "text-foreground"}`}>
                {value}
              </p>
            </div>
          ))}
        </div>

        {/* Internal notes */}
        {meta.internal_notes && (
          <div className="px-6 py-3 border-b border-border bg-secondary/20">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1">Internal Notes</p>
            <p className="text-xs text-foreground whitespace-pre-wrap">{meta.internal_notes}</p>
          </div>
        )}

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
                  {wo.service_request_description && (
                    <p className="text-xs text-muted-foreground border-t border-border pt-2">
                      <span className="text-foreground/60">Request: </span>
                      {wo.service_request_description}
                    </p>
                  )}
                  {wo.service_performed && (
                    <p className="text-xs text-muted-foreground">
                      <span className="text-foreground/60">Performed: </span>
                      {wo.service_performed}
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

// ---------------------------------------------------------------------------
// Main Assets View
// ---------------------------------------------------------------------------
export function AssetsView() {
  const [query, setQuery] = useState("")
  const [allAssets, setAllAssets] = useState<AssetSummary[]>([])
  const [displayedAssets, setDisplayedAssets] = useState<AssetSummary[]>([])
  const [selectedAsset, setSelectedAsset] = useState<AssetSummary | null>(null)
  const [managingSerial, setManagingSerial] = useState<string | null>(null)
  const [mergeGroup, setMergeGroup] = useState<{ serials: string[]; reason: string } | null>(null)
  const [duplicateWarnings, setDuplicateWarnings] = useState<Array<{ serials: string[]; reason: string }>>([])
  const [sortKey, setSortKey] = useState<keyof AssetSummary>("last_service_date")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function reload() {
    setTick(t => t + 1)
  }

  useEffect(() => {
    fetchAllAssets().then((assets) => {
      setAllAssets(assets)
      setDisplayedAssets(assets)
      setDuplicateWarnings(store.getDuplicateWarnings())
      setLoading(false)
    })
  }, [tick])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      if (!query.trim()) {
        setDisplayedAssets(allAssets)
        return
      }
      const results = await fetchAssets(query.trim())
      setDisplayedAssets(results)
    }, 300)
  }, [query, allAssets])

  const sorted = [...displayedAssets].sort((a, b) => {
    const aVal = a[sortKey] ?? ""
    const bVal = b[sortKey] ?? ""
    const dir = sortDir === "asc" ? 1 : -1
    return aVal < bVal ? -dir : aVal > bVal ? dir : 0
  })

  function toggleSort(key: keyof AssetSummary) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortKey(key); setSortDir("desc") }
  }

  function SortIcon({ col }: { col: keyof AssetSummary }) {
    if (sortKey !== col) return null
    return sortDir === "asc"
      ? <ChevronUp className="w-3 h-3 inline ml-1" />
      : <ChevronDown className="w-3 h-3 inline ml-1" />
  }

  const TH = ({ label, col }: { label: string; col?: keyof AssetSummary }) => (
    <th
      className={`text-left py-2 pr-4 text-[11px] text-muted-foreground uppercase tracking-wider font-medium whitespace-nowrap select-none ${col ? "cursor-pointer hover:text-foreground" : ""}`}
      onClick={() => col && toggleSort(col)}
    >
      {label}{col && <SortIcon col={col} />}
    </th>
  )

  return (
    <>
      {selectedAsset && (
        <AssetDetail
          asset={selectedAsset}
          onClose={() => setSelectedAsset(null)}
          onOpenManage={serial => {
            setSelectedAsset(null)
            setManagingSerial(serial)
          }}
        />
      )}

      {managingSerial && (
        <AssetManagePanel
          serial={managingSerial}
          onClose={() => setManagingSerial(null)}
          onSaved={() => { setManagingSerial(null); reload() }}
        />
      )}

      {mergeGroup && (
        <MergeModal
          group={mergeGroup}
          allAssets={allAssets}
          onClose={() => setMergeGroup(null)}
          onMerged={reload}
        />
      )}

      <div className="space-y-4">
        {/* Duplicate warnings banner */}
        {duplicateWarnings.length > 0 && (
          <div className="bg-warning/5 border border-warning/30 rounded px-4 py-3 space-y-2">
            <p className="text-xs font-medium text-warning flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5" />
              {duplicateWarnings.length} potential duplicate asset{duplicateWarnings.length > 1 ? "s" : ""} detected
            </p>
            {duplicateWarnings.map((w, i) => (
              <div key={i} className="flex items-center justify-between gap-4">
                <p className="text-xs text-muted-foreground">{w.reason} — serials: <span className="font-mono text-foreground">{w.serials.join(", ")}</span></p>
                <button
                  onClick={() => setMergeGroup(w)}
                  className="flex items-center gap-1.5 text-xs text-primary hover:underline shrink-0"
                >
                  <GitMerge className="w-3 h-3" />
                  Merge
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Search bar + export */}
        <div className="flex items-center gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search serial # or equipment ref..."
              className="w-full bg-card border border-border rounded pl-9 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <button
            onClick={() => exportAssetsCSV(sorted)}
            disabled={sorted.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 bg-card border border-border rounded text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>

        {/* Table */}
        <div className="bg-card border border-border rounded overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border">
                <tr>
                  <TH label="Serial #"      col="serial_number" />
                  <TH label="Equip Ref"     col="equipment_reference" />
                  <TH label="Model"         col="model" />
                  <TH label="Status"        />
                  <TH label="Work Orders"   col="total_work_orders" />
                  <TH label="Labor Hrs"     col="total_labor_hours" />
                  <TH label="Last Service"  col="last_service_date" />
                  <TH label="Problems"      col="problem_count" />
                  <TH label="" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-muted-foreground text-sm">Loading assets...</td>
                  </tr>
                ) : sorted.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-muted-foreground text-sm">No assets found.</td>
                  </tr>
                ) : (
                  sorted.map((asset) => {
                    const meta = store.getAssetMeta(asset.serial_number)
                    return (
                      <tr
                        key={asset.serial_number}
                        onClick={() => setSelectedAsset(asset)}
                        className="hover:bg-secondary/40 cursor-pointer transition-colors"
                      >
                        <td className="py-2.5 pr-4 pl-4 font-mono text-primary text-xs">{asset.serial_number}</td>
                        <td className="py-2.5 pr-4 text-muted-foreground">{asset.equipment_reference ?? "—"}</td>
                        <td className="py-2.5 pr-4">{asset.model ?? "—"}</td>
                        <td className="py-2.5 pr-4"><AssetStatusBadge status={meta.status} /></td>
                        <td className="py-2.5 pr-4 font-mono text-center">{asset.total_work_orders}</td>
                        <td className="py-2.5 pr-4 font-mono text-center">{asset.total_labor_hours?.toFixed(1) ?? "—"}</td>
                        <td className="py-2.5 pr-4 text-muted-foreground">{asset.last_service_date ?? "—"}</td>
                        <td className="py-2.5 pr-4">
                          {asset.problem_count > 0 ? (
                            <span className="flex items-center gap-1 text-warning text-xs font-mono">
                              <AlertTriangle className="w-3 h-3" /> {asset.problem_count}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">0</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-3">
                          <button
                            onClick={e => { e.stopPropagation(); setManagingSerial(asset.serial_number) }}
                            className="text-muted-foreground hover:text-foreground"
                            title="Manage asset"
                          >
                            <Settings className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t border-border text-[11px] text-muted-foreground">
            {sorted.length} asset{sorted.length !== 1 ? "s" : ""} · click a row to view work order history · gear icon to manage status and notes
          </div>
        </div>
      </div>
    </>
  )
}
