"use client"

import { useEffect, useState } from "react"
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts"
import {
  fetchIssueFrequency,
  fetchWorkOrders,
  fetchProblemAssets,
  issueLabel,
  type IssueFrequency,
  type WorkOrder,
  type ProblemAsset,
} from "@/lib/api"
import { AlertTriangle } from "lucide-react"

// ---------------------------------------------------------------------------
// Custom dark tooltip for Recharts
// ---------------------------------------------------------------------------
function DarkTooltip({ active, payload, label }: {
  active?: boolean; payload?: Array<{ value: number }>; label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-card border border-border rounded px-3 py-2 text-xs shadow-lg">
      <p className="text-muted-foreground mb-0.5">{label}</p>
      <p className="text-foreground font-semibold font-mono">{payload[0].value}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function OverviewView() {
  const [issues, setIssues] = useState<IssueFrequency[]>([])
  const [recentWOs, setRecentWOs] = useState<WorkOrder[]>([])
  const [problemAssets, setProblemAssets] = useState<ProblemAsset[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetchIssueFrequency(),
      fetchWorkOrders(),
      fetchProblemAssets(),
    ]).then(([iss, wos, problems]) => {
      setIssues(iss.slice(0, 8))
      setRecentWOs(wos.slice(0, 6))
      setProblemAssets(problems.slice(0, 5))
      setLoading(false)
    })
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
        Loading overview...
      </div>
    )
  }

  const chartData = issues.map((i) => ({ name: issueLabel(i.issue_code), count: i.count }))
  const CHART_COLORS = [
    "#3b82f6","#22d3ee","#a78bfa","#f59e0b","#ef4444",
    "#10b981","#ec4899","#f97316",
  ]

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      {/* Issue frequency chart — spans 2 cols */}
      <div className="xl:col-span-2">
        <Section title="Top Issues by Frequency">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 24 }}>
              <XAxis type="number" tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis
                type="category"
                dataKey="name"
                width={130}
                tick={{ fill: "#9ca3af", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<DarkTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
              <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                {chartData.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Section>
      </div>

      {/* Problem Assets panel */}
      <Section title="Problem Assets">
        <div className="space-y-2">
          {problemAssets.map((asset) => (
            <div
              key={asset.serial_number}
              className="flex items-start justify-between py-2 border-b border-border last:border-0"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3 text-warning shrink-0" />
                  <span className="text-sm font-mono text-foreground">{asset.serial_number}</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                  {asset.equipment_reference} · {asset.model}
                </p>
              </div>
              <div className="text-right shrink-0 ml-3">
                <p className="text-sm font-semibold font-mono text-warning">{asset.work_order_count}</p>
                <p className="text-[10px] text-muted-foreground">WOs</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Recent work orders */}
      <div className="xl:col-span-3">
        <Section title="Recent Work Orders">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-muted-foreground uppercase tracking-wider">
                  <th className="text-left pb-2 pr-4 font-medium">WO #</th>
                  <th className="text-left pb-2 pr-4 font-medium">Type</th>
                  <th className="text-left pb-2 pr-4 font-medium">Date</th>
                  <th className="text-left pb-2 pr-4 font-medium">Serial</th>
                  <th className="text-left pb-2 pr-4 font-medium">Technician</th>
                  <th className="text-left pb-2 font-medium">Issues</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recentWOs.map((wo) => (
                  <tr key={wo.work_order_no} className="hover:bg-secondary/40 transition-colors">
                    <td className="py-2 pr-4 font-mono text-primary">{wo.work_order_no}</td>
                    <td className="py-2 pr-4">
                      <WOTypeBadge type={wo.work_order_type} />
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">{wo.date_completed ?? "—"}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{wo.serial_number ?? "—"}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{wo.technician ?? "—"}</td>
                    <td className="py-2">
                      <IssueTags issues={wo.issues} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared mini-components
// ---------------------------------------------------------------------------
export function WOTypeBadge({ type }: { type: string | null }) {
  if (!type) return <span className="text-muted-foreground">—</span>
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase font-mono
      ${type === "PM"
        ? "bg-primary/15 text-primary"
        : "bg-warning/15 text-warning"
      }`}>
      {type}
    </span>
  )
}

export function IssueTags({ issues }: { issues: string | null }) {
  if (!issues) return <span className="text-muted-foreground text-xs">—</span>
  const codes = issues.split(",").filter(Boolean).slice(0, 3)
  return (
    <div className="flex flex-wrap gap-1">
      {codes.map((code) => (
        <span
          key={code}
          className="inline-block px-1.5 py-0.5 text-[10px] rounded bg-secondary text-muted-foreground"
        >
          {issueLabel(code)}
        </span>
      ))}
    </div>
  )
}
