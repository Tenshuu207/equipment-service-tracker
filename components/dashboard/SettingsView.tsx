"use client"

import { useEffect, useState } from "react"
import {
  fetchIngestionSources,
  createIngestionSource,
  updateIngestionSource,
  deleteIngestionSource,
  type IngestionSource,
} from "@/lib/api"
import {
  FolderOpen, Plus, Trash2, Save, ToggleLeft, ToggleRight,
  RefreshCw, ChevronDown, ChevronUp,
} from "lucide-react"

const BLANK_SOURCE: Omit<IngestionSource, "id" | "created_at" | "updated_at"> = {
  name: "",
  folder_path: "",
  enabled: true,
  allowed_types: ".pdf,.eml,.msg",
  processed_folder: "",
  failed_folder: "",
  recursive: false,
}

function SourceForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial: Omit<IngestionSource, "id" | "created_at" | "updated_at">
  onSave: (data: Omit<IngestionSource, "id" | "created_at" | "updated_at">) => void
  onCancel: () => void
  saving: boolean
}) {
  const [form, setForm] = useState(initial)

  function set(key: keyof typeof form, value: unknown) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  const F = ({ label, field, placeholder, hint }: {
    label: string
    field: keyof typeof form
    placeholder?: string
    hint?: string
  }) => (
    <div className="space-y-1">
      <label className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </label>
      <input
        type="text"
        value={(form[field] as string) ?? ""}
        onChange={e => set(field, e.target.value)}
        placeholder={placeholder}
        className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono"
      />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )

  return (
    <div className="border border-border rounded p-4 bg-background space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <F label="Source Name"  field="name"        placeholder="Crown Incoming" />
        <F label="Allowed File Types" field="allowed_types" placeholder=".pdf,.eml,.msg" hint="Comma-separated extensions" />
      </div>
      <F label="Folder Path (Incoming)" field="folder_path"
         placeholder="\\\\server\\share\\Incoming"
         hint="Leave processed/failed blank to auto-create Processed/ and Failed/ siblings" />
      <div className="grid grid-cols-2 gap-4">
        <F label="Processed Folder (optional)" field="processed_folder" placeholder="\\\\server\\share\\Processed" />
        <F label="Failed Folder (optional)"    field="failed_folder"    placeholder="\\\\server\\share\\Failed" />
      </div>
      <div className="flex items-center gap-6">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <button
            type="button"
            onClick={() => set("enabled", !form.enabled)}
            className="text-muted-foreground hover:text-foreground"
          >
            {form.enabled
              ? <ToggleRight className="w-5 h-5 text-primary" />
              : <ToggleLeft className="w-5 h-5" />}
          </button>
          <span className="text-sm">{form.enabled ? "Enabled" : "Disabled"}</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <button
            type="button"
            onClick={() => set("recursive", !form.recursive)}
            className="text-muted-foreground hover:text-foreground"
          >
            {form.recursive
              ? <ToggleRight className="w-5 h-5 text-primary" />
              : <ToggleLeft className="w-5 h-5" />}
          </button>
          <span className="text-sm">{form.recursive ? "Recursive (scan subfolders)" : "Top-level only"}</span>
        </label>
      </div>
      <div className="flex items-center gap-3 pt-2 border-t border-border">
        <button
          onClick={() => onSave(form)}
          disabled={saving || !form.name.trim() || !form.folder_path.trim()}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Save Source
        </button>
        <button onClick={onCancel} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      </div>
    </div>
  )
}

function SourceRow({
  source,
  onToggle,
  onDelete,
  onEdit,
}: {
  source: IngestionSource
  onToggle: () => void
  onDelete: () => void
  onEdit: () => void
}) {
  const allowedList = source.allowed_types.split(",").map(t => t.trim()).filter(Boolean)
  return (
    <div className={`border border-border rounded p-4 space-y-3 ${!source.enabled ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <FolderOpen className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{source.name}</p>
            <p className="text-[11px] text-muted-foreground font-mono truncate mt-0.5">{source.folder_path}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onToggle}
            title={source.enabled ? "Disable" : "Enable"}
            className="text-muted-foreground hover:text-foreground"
          >
            {source.enabled
              ? <ToggleRight className="w-5 h-5 text-primary" />
              : <ToggleLeft className="w-5 h-5" />}
          </button>
          <button onClick={onEdit} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 border border-border rounded">
            Edit
          </button>
          <button onClick={onDelete} className="text-muted-foreground hover:text-destructive">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[11px]">
        <span className="flex items-center gap-1 text-muted-foreground">
          Types:
          {allowedList.map(t => (
            <span key={t} className="bg-secondary px-1.5 py-0.5 rounded font-mono text-foreground">{t}</span>
          ))}
        </span>
        {source.recursive && (
          <span className="bg-secondary px-1.5 py-0.5 rounded text-muted-foreground">Recursive</span>
        )}
        {source.processed_folder && (
          <span className="text-muted-foreground font-mono truncate max-w-[200px]">
            Processed: {source.processed_folder}
          </span>
        )}
        {source.failed_folder && (
          <span className="text-muted-foreground font-mono truncate max-w-[200px]">
            Failed: {source.failed_folder}
          </span>
        )}
        <span className="ml-auto text-muted-foreground">
          Updated: {new Date(source.updated_at).toLocaleDateString()}
        </span>
      </div>
    </div>
  )
}

export function SettingsView() {
  const [sources, setSources] = useState<IngestionSource[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null)

  async function load() {
    const data = await fetchIngestionSources()
    setSources(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function flash(text: string, type: "success" | "error" = "success") {
    setMessage({ text, type })
    setTimeout(() => setMessage(null), 3000)
  }

  async function handleCreate(data: Omit<IngestionSource, "id" | "created_at" | "updated_at">) {
    setSaving(true)
    try {
      const created = await createIngestionSource(data)
      setSources(prev => [...prev, created])
      setAdding(false)
      flash("Ingestion source added.")
    } catch (e) {
      flash("Failed to save source.", "error")
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdate(id: number, data: Omit<IngestionSource, "id" | "created_at" | "updated_at">) {
    setSaving(true)
    try {
      await updateIngestionSource(id, data)
      setSources(prev => prev.map(s => s.id === id ? { ...s, ...data } : s))
      setEditingId(null)
      flash("Source updated.")
    } catch (e) {
      flash("Failed to update source.", "error")
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(source: IngestionSource) {
    const newEnabled = !source.enabled
    await updateIngestionSource(source.id, { enabled: newEnabled })
    setSources(prev => prev.map(s => s.id === source.id ? { ...s, enabled: newEnabled } : s))
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this ingestion source?")) return
    await deleteIngestionSource(id)
    setSources(prev => prev.filter(s => s.id !== id))
    flash("Source deleted.")
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Ingestion Sources</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure folders the importer scans for service confirmation files.
          </p>
        </div>
        {!adding && (
          <button
            onClick={() => { setAdding(true); setEditingId(null) }}
            className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded text-xs font-medium hover:bg-primary/90"
          >
            <Plus className="w-3.5 h-3.5" /> Add Source
          </button>
        )}
      </div>

      {/* Flash message */}
      {message && (
        <div className={`px-4 py-2 rounded text-sm border ${message.type === "success" ? "bg-emerald-900/20 border-emerald-500/30 text-emerald-400" : "bg-destructive/10 border-destructive/30 text-destructive"}`}>
          {message.text}
        </div>
      )}

      {/* Add form */}
      {adding && (
        <SourceForm
          initial={BLANK_SOURCE}
          onSave={handleCreate}
          onCancel={() => setAdding(false)}
          saving={saving}
        />
      )}

      {/* Source list */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading sources...</p>
      ) : sources.length === 0 && !adding ? (
        <div className="border border-border rounded p-8 text-center text-sm text-muted-foreground">
          No ingestion sources configured. Add one to get started.
        </div>
      ) : (
        <div className="space-y-3">
          {sources.map(source => (
            editingId === source.id ? (
              <SourceForm
                key={source.id}
                initial={{
                  name: source.name,
                  folder_path: source.folder_path,
                  enabled: source.enabled,
                  allowed_types: source.allowed_types,
                  processed_folder: source.processed_folder ?? "",
                  failed_folder: source.failed_folder ?? "",
                  recursive: source.recursive,
                }}
                onSave={data => handleUpdate(source.id, data)}
                onCancel={() => setEditingId(null)}
                saving={saving}
              />
            ) : (
              <SourceRow
                key={source.id}
                source={source}
                onToggle={() => handleToggle(source)}
                onDelete={() => handleDelete(source.id)}
                onEdit={() => { setEditingId(source.id); setAdding(false) }}
              />
            )
          ))}
        </div>
      )}

      {/* Importer CLI reference */}
      <div className="border border-border rounded p-4 space-y-3 mt-2">
        <h4 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Running the Importer
        </h4>
        <div className="space-y-2 text-xs text-muted-foreground">
          <p>Import all enabled sources (recommended):</p>
          <pre className="bg-background border border-border rounded px-3 py-2 text-green-400 font-mono overflow-x-auto">
{`python scripts/importer.py --all-sources --db ./data/crown_service.db`}
          </pre>
          <p className="mt-2">Watch mode (polls every 5 minutes):</p>
          <pre className="bg-background border border-border rounded px-3 py-2 text-green-400 font-mono overflow-x-auto">
{`python scripts/importer.py --all-sources --watch --interval 300`}
          </pre>
          <p className="mt-2">Import a specific folder once:</p>
          <pre className="bg-background border border-border rounded px-3 py-2 text-green-400 font-mono overflow-x-auto">
{`python scripts/importer.py --folder "\\\\server\\share\\Incoming" --source-id 1`}
          </pre>
          <p className="mt-2">Dry run (parse only, no DB writes):</p>
          <pre className="bg-background border border-border rounded px-3 py-2 text-green-400 font-mono overflow-x-auto">
{`python scripts/importer.py --folder "\\\\server\\share\\Incoming" --dry-run`}
          </pre>
        </div>
      </div>
    </div>
  )
}
