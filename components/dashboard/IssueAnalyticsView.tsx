"use client"

import { useEffect, useState } from "react"
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from "recharts"
import {
  fetchIssueFrequency,
  fetchProblemAssets,
  issueLabel,
  type IssueFrequency,
  type ProblemAsset,
} from "@/lib/api"

const CHART_COLORS = [
  "#3b82f6","#22d3ee","#a78bfa","#f59e0b","#ef4444",
  "#10b981","#ec4899","#f97316","#14b8a6","#8b5cf6",
]

function DarkTooltip({ active, payload, label }: {
  active?: boolean; payload?: Array<{ value: number; name?: string }>; label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-card border border-border rounded px-3 py-2 text-xs shadow-lg">
      <p className="text-muted-foreground mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="font-mono font-semibold text-foreground">{p.value}</p>
      ))}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-4">{children}</h3>
  )
}

// ---------------------------------------------------------------------------
// Issue frequency bar chart with date filters
// ---------------------------------------------------------------------------
function IssueFrequencyPanel() {
  const [issues, setIssues] = useState<IssueFrequency[]>([])
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetchIssueFrequency({
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }).then((data) => { setIssues(data); setLoading(false) })
  }, [dateFrom, dateTo])

  const chartData = issues.map((i) => ({ name: issueLabel(i.issue_code), count: i.count }))
  const total = issues.reduce((s, i) => s + i.count, 0)

  return (
    <div className="bg-card border border-border rounded">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-wrap gap-3">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Issue Frequency</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">{total} total occurrences</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>From</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <span>To</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      <div className="p-4">
        {loading ? (
          <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">Loading...</div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 32, top: 4, bottom: 4 }}>
              <XAxis type="number" tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis
                type="category"
                dataKey="name"
                width={145}
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
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Issues per asset table
// ---------------------------------------------------------------------------
function IssuesPerAssetPanel() {
  const [problemAssets, setProblemAssets] = useState<ProblemAsset[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchProblemAssets().then((data) => { setProblemAssets(data); setLoading(false) })
  }, [])

  return (
    <div className="bg-card border border-border rounded">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Issues Per Asset</h3>
        <p className="text-[11px] text-muted-foreground mt-0.5">Distinct issue types logged per equipment unit</p>
      </div>
      <div className="p-4">
        {loading ? (
          <p className="text-muted-foreground text-sm py-8 text-center">Loading...</p>
        ) : (
          <div className="space-y-3">
            {problemAssets.slice(0, 10).map((asset) => {
              const issues = asset.issue_list?.split(",").filter(Boolean) ?? []
              const maxCount = problemAssets[0]?.unique_issues ?? 1
              const pct = (asset.unique_issues / maxCount) * 100

              return (
                <div key={asset.serial_number} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono text-foreground">
                      {asset.serial_number}
                      {asset.equipment_reference && (
                        <span className="text-muted-foreground ml-2">({asset.equipment_reference})</span>
                      )}
                    </span>
                    <span className="font-mono text-muted-foreground">{asset.unique_issues} types</span>
                  </div>
                  {/* Progress bar */}
                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-chart-1 rounded-full transition-all"
                      style={{ width: `${pct}%`, background: CHART_COLORS[0] }}
                    />
                  </div>
                  {/* Issue pills */}
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {issues.map((code) => (
                      <span
                        key={code}
                        className="text-[10px] bg-secondary text-muted-foreground px-1.5 py-0.5 rounded"
                      >
                        {issueLabel(code)}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Issue breakdown donut
// ---------------------------------------------------------------------------
function IssueDonut() {
  const [issues, setIssues] = useState<IssueFrequency[]>([])

  useEffect(() => {
    fetchIssueFrequency().then((data) => setIssues(data.slice(0, 6)))
  }, [])

  const data = issues.map((i) => ({ name: issueLabel(i.issue_code), value: i.count }))

  return (
    <div className="bg-card border border-border rounded">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Issue Distribution</h3>
        <p className="text-[11px] text-muted-foreground mt-0.5">Top 6 categories</p>
      </div>
      <div className="p-4 flex justify-center">
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={85}
              dataKey="value"
              paddingAngle={2}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Legend
              iconSize={8}
              iconType="circle"
              formatter={(value) => <span style={{ color: "#9ca3af", fontSize: 11 }}>{value}</span>}
            />
            <Tooltip content={<DarkTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------
export function IssueAnalyticsView() {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div className="xl:col-span-2">
        <IssueFrequencyPanel />
      </div>
      <IssueDonut />
      <div className="xl:col-span-3">
        <IssuesPerAssetPanel />
      </div>
    </div>
  )
}
