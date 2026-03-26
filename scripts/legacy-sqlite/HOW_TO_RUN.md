# Crown Service Equipment Tracking System
## Phase 1 + 2: Importer Setup & Phase 3: Dashboard

---

## Prerequisites

- Python 3.10+
- `pip` or `uv`
- Node.js 18+ (for dashboard only)

---

## 1. Install Python Dependencies

```bash
cd scripts
pip install -r requirements.txt
```

Or with uv:
```bash
cd scripts
uv venv
uv pip install -r requirements.txt
```

---

## 2. Initialize the Database

Run once. Safe to re-run (uses IF NOT EXISTS).

```bash
cd scripts
python init_db.py --db ../data/crown_service.db
```

To reset and recreate from scratch:
```bash
python init_db.py --db ../data/crown_service.db --reset
```

---

## 3. Run the Importer

### One-time run (production network path):
```bash
python importer.py \
  --folder "\\dennis.com\shares\Operations Shared Files\Day Warehouse\Warehouse Equipment\Crown Service Tracking\Incoming" \
  --db ../data/crown_service.db
```

### Local test run:
```bash
python importer.py --folder ./samples/Incoming --db ../data/crown_service.db
```

### Watch mode (run every 5 minutes continuously):
```bash
python importer.py \
  --folder "\\dennis.com\shares\...\Incoming" \
  --db ../data/crown_service.db \
  --watch --interval 300
```

### Dry run (validate without writing to DB or moving files):
```bash
python importer.py --folder ./samples/Incoming --dry-run
```

---

## 4. File Structure After Import

```
Incoming/          ← drop PDFs and MSG files here
Processed/         ← successfully imported files (auto-created)
Failed/            ← files that failed to parse (auto-created)
data/
  crown_service.db ← SQLite database
  logs/
    importer.log   ← rotating log file (5MB x 5 backups)
```

---

## 5. Run the Dashboard

### Start the FastAPI backend:
```bash
cd scripts/dashboard
pip install fastapi uvicorn
uvicorn api:app --host 0.0.0.0 --port 8000 --reload
```

### Start the Next.js frontend:
```bash
# In project root
npm install
npm run dev
```

Then open: http://localhost:3000

The dashboard auto-connects to http://localhost:8000 when
`NEXT_PUBLIC_API_BASE_URL=http://localhost:8000` is set.

Without the backend, the dashboard runs on rich mock data.

---

## 6. Module Summary

| File                   | Purpose                                        |
|------------------------|------------------------------------------------|
| `schema.sql`           | SQLite table definitions and views             |
| `models.py`            | Dataclasses: Asset, WorkOrder, ParsedDocument  |
| `db.py`                | All SQL — upserts, queries, import tracking    |
| `parser.py`            | PDF + MSG text extraction and field parsing    |
| `validator.py`         | Validation, normalization, issue detection     |
| `importer.py`          | Orchestrates parse → validate → DB → move      |
| `init_db.py`           | CLI to initialize or reset the database        |
| `dashboard/api.py`     | FastAPI backend serving JSON to the frontend   |
| `lib/api.ts`           | TypeScript API client with mock data fallback  |
| `app/page.tsx`         | Main dashboard UI entry point                  |

---

## 7. Extending the Parser

The parser in `parser.py` uses regex patterns. When Crown PDF layouts change:

1. Identify the new field label text from the PDF
2. Add a new regex pattern to the relevant `_extract_field()` call
3. All existing patterns still work — new ones are tried in order

Issue detection is keyword-based. To add new issue categories:
1. Add a new entry to `IssueCode` enum in `models.py`
2. Add keywords to `ISSUE_KEYWORD_MAP` in `models.py`
No other changes needed.

---

## 8. Windows Task Scheduler (watch mode as service)

Create a scheduled task that runs every 5 minutes:
```
Program: C:\Python310\python.exe
Arguments: C:\path\to\scripts\importer.py --folder "\\server\path\Incoming" --db C:\path\to\data\crown_service.db
Run whether user is logged on or not
```
