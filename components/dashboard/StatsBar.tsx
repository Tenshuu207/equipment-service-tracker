import { DashboardStats } from "@/lib/api"
import { PackageSearch, Wrench, ShieldAlert, Tag, Clock } from "lucide-react"

interface StatCardProps {
  label: string
  value: string | number
  icon: React.ElementType
  highlight?: boolean
  sub?: string
}

function StatCard({ label, value, icon: Icon, highlight, sub }: StatCardProps) {
  return (
    <div className="flex flex-col gap-1 bg-card border border-border rounded px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">{label}</span>
        <Icon className={`w-3.5 h-3.5 ${highlight ? "text-warning" : "text-muted-foreground"}`} />
      </div>
      <span className={`text-2xl font-semibold font-mono ${highlight ? "text-warning" : "text-foreground"}`}>
        {value}
      </span>
      {sub && <span className="text-[10px] text-muted-foreground">{sub}</span>}
    </div>
  )
}

export function StatsBar({ stats }: { stats: DashboardStats }) {
  const lastImport = stats.last_import
    ? new Date(stats.last_import).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "Never"

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3">
      <StatCard label="Total Assets"      value={stats.total_assets}      icon={PackageSearch} />
      <StatCard label="Work Orders"       value={stats.total_work_orders} icon={Wrench} />
      <StatCard label="Issues Recorded"   value={stats.total_issues}      icon={Tag} />
      <StatCard
        label="Problem Assets"
        value={stats.problem_assets}
        icon={ShieldAlert}
        highlight={stats.problem_assets > 0}
        sub="Repeated or flagged"
      />
      <StatCard
        label="Last Import"
        value={lastImport}
        icon={Clock}
        sub={stats.last_import ? "UTC" : undefined}
      />
    </div>
  )
}
