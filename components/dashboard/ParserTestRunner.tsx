"use client"

import { useState } from "react"
import { runParserTests, type ParserTestSummary } from "@/lib/parser-tests"
import { CheckCircle2, XCircle, RefreshCw, FlaskConical } from "lucide-react"

export function ParserTestRunner() {
  const [running, setRunning]   = useState(false)
  const [summary, setSummary]   = useState<ParserTestSummary | null>(null)
  const [open, setOpen]         = useState(false)

  async function run() {
    setRunning(true)
    const result = await runParserTests()
    setSummary(result)
    setRunning(false)
  }

  return (
    <div className="bg-card border border-border rounded overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-secondary/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <FlaskConical className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="font-medium text-foreground">Parser Regression Tests</span>
          <span className="text-[10px] bg-secondary text-muted-foreground px-1.5 py-0.5 rounded font-medium tracking-wide uppercase">Dev</span>
          {summary && (
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
              summary.failed === 0
                ? "bg-emerald-900/20 text-emerald-400"
                : "bg-destructive/10 text-destructive"
            }`}>
              {summary.passed}/{summary.total} passed
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-border px-4 py-4 space-y-4">
          <p className="text-xs text-muted-foreground">
            Runs 6 regression tests against exact Crown PDF text patterns from real service documents.
            Each test verifies that the correct WO #, serial, model, technician, date, hours, and issue codes are extracted.
            No files are uploaded — tests run entirely in-browser against synthetic text fixtures.
          </p>

          <button
            onClick={run}
            disabled={running}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {running
              ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Running tests...</>
              : <><FlaskConical className="w-3.5 h-3.5" />Run all tests</>
            }
          </button>

          {summary && (
            <div className="space-y-2">
              {/* Summary bar */}
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="text-foreground font-mono">{summary.timestamp.slice(0, 19).replace("T", " ")} UTC</span>
                <span className="text-emerald-400">{summary.passed} passed</span>
                {summary.failed > 0 && <span className="text-destructive">{summary.failed} failed</span>}
              </div>

              {/* Individual results */}
              <div className="space-y-1">
                {summary.results.map((r, i) => (
                  <div key={i} className={`rounded border px-3 py-2.5 ${r.passed ? "border-emerald-900/30 bg-emerald-900/5" : "border-destructive/30 bg-destructive/5"}`}>
                    <div className="flex items-center gap-2">
                      {r.passed
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        : <XCircle     className="w-3.5 h-3.5 text-destructive shrink-0" />
                      }
                      <span className="text-xs text-foreground">{r.name}</span>
                    </div>

                    {/* Show failures */}
                    {r.failures.length > 0 && (
                      <ul className="mt-2 ml-5 space-y-0.5">
                        {r.failures.map((f, fi) => (
                          <li key={fi} className="text-[11px] text-destructive font-mono">{f}</li>
                        ))}
                      </ul>
                    )}

                    {/* Show parsed fields for passing tests */}
                    {r.passed && (
                      <div className="mt-1.5 ml-5 grid grid-cols-3 gap-x-4 gap-y-0.5">
                        {Object.entries(r.parsed)
                          .filter(([, v]) => v !== null && v !== undefined && v !== "")
                          .slice(0, 9)
                          .map(([k, v]) => (
                            <span key={k} className="text-[10px] text-muted-foreground font-mono truncate">
                              <span className="text-foreground/50">{k}:</span> {String(v).slice(0, 30)}
                            </span>
                          ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
