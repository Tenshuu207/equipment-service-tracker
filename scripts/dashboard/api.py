"""
dashboard/api.py — FastAPI backend for Crown Service Equipment Dashboard.

Serves JSON endpoints consumed by the Next.js frontend.
Also handles file upload triggers from the UI.

Run:
    cd scripts/dashboard
    uvicorn api:app --host 0.0.0.0 --port 8000 --reload

Or from project root:
    uvicorn scripts.dashboard.api:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

# Ensure scripts/ is on the path when running from dashboard/
sys.path.insert(0, str(Path(__file__).parent.parent))

from db import Database

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

DB_PATH = Path(__file__).parent.parent.parent / "data" / "crown_service.db"

app = FastAPI(
    title="Crown Service Equipment API",
    description="Internal API for warehouse equipment service tracking.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3002",
        "http://127.0.0.1:3002",
        "http://192.168.18.158:3000",
        "http://192.168.18.158:3002",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db() -> Database:
    """Get a Database instance. Creates the DB file if it doesn't exist."""
    return Database(db_path=DB_PATH)


# ---------------------------------------------------------------------------
# Health / Status
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health_check():
    return {"status": "ok", "db": str(DB_PATH)}


@app.get("/api/stats")
def get_stats():
    """Dashboard summary statistics."""
    db = get_db()
    return db.get_dashboard_stats()


@app.get("/api/import-runs")
def get_import_runs(limit: int = Query(20, ge=1, le=100)):
    """Recent import run history."""
    db = get_db()
    return db.get_recent_import_runs(limit=limit)

@app.get("/api/import-files")
def get_import_files(
    run_id: Optional[int] = Query(None),
    limit: int = Query(100, ge=1, le=500),
):
    """Recent import files, optionally filtered by import run ID."""
    db = get_db()
    if run_id is not None:
        return {"results": db.get_import_files_for_run(run_id), "count": len(db.get_import_files_for_run(run_id))}
    rows = db.get_recent_import_files(limit=limit)
    return {"results": rows, "count": len(rows)}


# ---------------------------------------------------------------------------
# Asset Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/assets/search")
def search_assets(q: str = Query("", min_length=0), limit: int = Query(50, ge=1, le=200)):
    """Search assets by serial number or equipment reference. Empty query returns recent/all assets."""
    db = get_db()
    results = db.search_assets(query=q, limit=limit)
    return {"results": results, "count": len(results)}


@app.get("/api/assets/{serial_number}")
def get_asset(serial_number: str):
    """Get a single asset with its full work order history."""
    db = get_db()
    asset = db.get_asset(serial_number)
    if not asset:
        raise HTTPException(status_code=404, detail=f"Asset not found: {serial_number}")
    work_orders = db.get_work_orders_for_asset(serial_number)
    return {
        "asset": asset,
        "work_orders": work_orders,
        "work_order_count": len(work_orders),
    }


@app.get("/api/problem-assets")
def get_problem_assets(limit: int = Query(50, ge=1, le=200)):
    """Assets ranked by repeat issues and total work orders."""
    db = get_db()
    return {"results": db.get_problem_assets(limit=limit)}


# ---------------------------------------------------------------------------
# Work Order Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/work-orders")
def get_work_orders(
    date_from: Optional[str] = Query(None, description="YYYY-MM-DD"),
    date_to: Optional[str] = Query(None, description="YYYY-MM-DD"),
    issue_code: Optional[str] = Query(None),
    technician: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
):
    """Filtered work order list."""
    db = get_db()
    results = db.get_work_orders_filtered(
        date_from=date_from,
        date_to=date_to,
        issue_code=issue_code,
        technician=technician,
        limit=limit,
    )
    return {"results": results, "count": len(results)}


# ---------------------------------------------------------------------------
# Issue Analytics Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/issues/frequency")
def get_issue_frequency(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
):
    """Issue frequency counts, optionally filtered by date range."""
    db = get_db()
    return {"results": db.get_issue_frequency(date_from=date_from, date_to=date_to)}


@app.get("/api/issues/by-asset")
def get_issues_by_asset():
    """Issue counts grouped by asset."""
    db = get_db()
    return {"results": db.get_issues_per_asset()}


# ---------------------------------------------------------------------------
# Reference Data
# ---------------------------------------------------------------------------

@app.get("/api/technicians")
def get_technicians():
    """List of all technicians in the database."""
    db = get_db()
    return {"technicians": db.get_all_technicians()}
