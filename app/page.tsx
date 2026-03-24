"use client"

import { useEffect, useState } from "react"
import { Sidebar, type View } from "@/components/dashboard/Sidebar"
import { StatsBar } from "@/components/dashboard/StatsBar"
import { OverviewView } from "@/components/dashboard/OverviewView"
import { AssetsView } from "@/components/dashboard/AssetsView"
import { WorkOrdersView } from "@/components/dashboard/WorkOrdersView"
import { IssueAnalyticsView } from "@/components/dashboard/IssueAnalyticsView"
import { ProblemAssetsView } from "@/components/dashboard/ProblemAssetsView"
import { ImportHistoryView } from "@/components/dashboard/ImportHistoryView"
import { ReviewQueueView } from "@/components/dashboard/ReviewQueueView"
import { SettingsView } from "@/components/dashboard/SettingsView"
import { fetchStats, isMockMode, type DashboardStats } from "@/lib/api"
import { AlertTriangle } from "lucide-react"

// Zero-state defaults — intentionally empty so stale numbers never show.
// fetchStats() will populate this from the live backend or the in-memory mock store.
const EMPTY_STATS: DashboardStats = {
  total_assets: 0,
  total_work_orders: 0,
  total_issues: 0,
  problem_assets: 0,
  last_import: null,
}

const VIEW_TITLES: Record<View, string> = {
  "overview":       "Overview",
  "assets":         "Asset Lookup",
  "work-orders":    "Work Orders",
  "issues":         "Issue Analytics",
  "problem-assets": "Problem Assets",
  "import-history": "Import History",
  "review-queue":   "Review Queue",
  "settings":       "Settings",
}

const VIEW_DESCRIPTIONS: Record<View, string> = {
  "overview":       "Summary of fleet service activity and top issues",
  "assets":         "Search and inspect individual equipment service history",
  "work-orders":    "Filter and review all service records",
  "issues":         "Breakdown of issue types, frequency, and affected assets",
  "problem-assets": "Assets ranked by repeat issues and total work orders",
  "import-history": "Record of all file import runs",
  "review-queue":   "Work orders flagged for manual review due to low parser confidence",
  "settings":       "Configure ingestion sources and importer options",
}

export default function DashboardPage() {
  const [view, setView] = useState<View>("overview")
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS)
  const [reviewCount, setReviewCount] = useState(0)
  const mockMode = isMockMode()

  useEffect(() => {
    fetchStats().then(setStats)
  }, [])

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar
        activeView={view}
        onNavigate={setView}
        totalAssets={stats.total_assets}
        totalWorkOrders={stats.total_work_orders}
        reviewCount={reviewCount}
      />

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center justify-between px-6 h-14 border-b border-border shrink-0">
          <div className="flex flex-col justify-center">
            <h1 className="text-sm font-semibold text-foreground leading-none">
              {VIEW_TITLES[view]}
            </h1>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-none">
              {VIEW_DESCRIPTIONS[view]}
            </p>
          </div>
          {stats.last_import && (
            <span className="text-[11px] text-muted-foreground">
              Last import:{" "}
              <span className="text-foreground font-mono">
                {new Date(stats.last_import).toLocaleDateString("en-US", {
                  month: "short", day: "numeric", year: "numeric",
                })}
              </span>
            </span>
          )}
        </header>

        {/* Mock-mode warning banner */}
        {mockMode && (
          <div className="shrink-0 flex items-center gap-2.5 px-6 py-2 bg-warning/10 border-b border-warning/30 text-warning text-xs">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>
              <strong>Demo mode</strong> — no backend connected.
              Data shown is in-memory only and resets on page refresh.
              Set <code className="font-mono bg-warning/10 px-1 rounded">NEXT_PUBLIC_API_BASE_URL</code> to connect a live backend.
            </span>
          </div>
        )}

        {/* Content area */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {/* Stats bar — visible on overview only */}
          {view === "overview" && <StatsBar stats={stats} />}

          {/* View rendering */}
          {view === "overview"       && <OverviewView />}
          {view === "assets"         && <AssetsView />}
          {view === "work-orders"    && <WorkOrdersView />}
          {view === "issues"         && <IssueAnalyticsView />}
          {view === "problem-assets" && <ProblemAssetsView />}
          {view === "import-history" && <ImportHistoryView />}
          {view === "review-queue"   && <ReviewQueueView onCountChange={setReviewCount} />}
          {view === "settings"       && <SettingsView />}
        </div>
      </main>
    </div>
  )
}
