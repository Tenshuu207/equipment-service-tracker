"use client"

import { cn } from "@/lib/utils"
import {
  LayoutDashboard,
  Wrench,
  PackageSearch,
  BarChart2,
  AlertTriangle,
  History,
  Forklift,
  ClipboardList,
  Settings,
  FileCheck,
} from "lucide-react"

export type View =
  | "overview"
  | "work-orders"
  | "assets"
  | "issues"
  | "problem-assets"
  | "import-history"
  | "review-queue"
  | "settings"

interface NavItem {
  id: View
  label: string
  icon: React.ElementType
  section?: string
  badge?: string
}

const NAV_ITEMS: NavItem[] = [
  { id: "overview",       label: "Overview",        icon: LayoutDashboard, section: "DASHBOARD" },
  { id: "assets",         label: "Asset Lookup",    icon: PackageSearch,   section: "EQUIPMENT" },
  { id: "work-orders",    label: "Work Orders",     icon: Wrench },
  { id: "issues",         label: "Issue Analytics", icon: BarChart2,       section: "ANALYTICS" },
  { id: "problem-assets", label: "Problem Assets",  icon: AlertTriangle },
  { id: "import-history", label: "Import History",  icon: History,         section: "INGEST" },
  { id: "review-queue",   label: "Review Queue",    icon: ClipboardList },
  { id: "settings",       label: "Settings",        icon: Settings,        section: "SYSTEM" },
]

interface SidebarProps {
  activeView: View
  onNavigate: (view: View) => void
  totalAssets: number
  totalWorkOrders: number
  reviewCount?: number
}

export function Sidebar({ activeView, onNavigate, totalAssets, totalWorkOrders, reviewCount = 0 }: SidebarProps) {
  let lastSection = ""

  return (
    <aside className="flex flex-col w-56 min-h-screen bg-sidebar border-r border-border shrink-0">
      {/* Wordmark */}
      <div className="flex items-center gap-2.5 px-4 h-14 border-b border-border">
        <div className="flex items-center justify-center w-7 h-7 rounded bg-primary/20">
          <Forklift className="w-4 h-4 text-primary" />
        </div>
        <div className="flex flex-col leading-none">
          <span className="text-xs font-semibold text-foreground tracking-wide">Crown Service</span>
          <span className="text-[10px] text-muted-foreground">Equipment Tracker</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const showSection = item.section && item.section !== lastSection
          if (item.section) lastSection = item.section

          return (
            <div key={item.id}>
              {showSection && (
                <p className="px-4 pt-5 pb-1.5 text-[10px] font-semibold tracking-widest text-muted-foreground/60 uppercase">
                  {item.section}
                </p>
              )}
              <button
                onClick={() => onNavigate(item.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors",
                  activeView === item.id
                    ? "bg-primary/10 text-primary font-medium border-r-2 border-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                )}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                <span className="flex-1 text-left">{item.label}</span>
                {item.id === "review-queue" && reviewCount > 0 && (
                  <span className="text-[10px] bg-warning/20 text-warning font-mono px-1.5 py-0.5 rounded-full leading-none">
                    {reviewCount}
                  </span>
                )}
              </button>
            </div>
          )
        })}
      </nav>

      {/* Bottom DB stats */}
      <div className="px-4 py-4 border-t border-border space-y-1">
        <div className="flex justify-between text-[11px]">
          <span className="text-muted-foreground">Assets tracked</span>
          <span className="text-foreground font-mono font-medium">{totalAssets}</span>
        </div>
        <div className="flex justify-between text-[11px]">
          <span className="text-muted-foreground">Work orders</span>
          <span className="text-foreground font-mono font-medium">{totalWorkOrders}</span>
        </div>
      </div>
    </aside>
  )
}
