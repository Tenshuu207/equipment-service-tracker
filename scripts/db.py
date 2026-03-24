"""
db.py - Database access layer for Crown Service Equipment Tracking.

Responsibilities:
- Open and initialize the SQLite database
- Provide typed upsert/insert functions for every table
- Keep SQL out of importer.py and dashboard code
- Expose read queries used by dashboard

No ORM. Raw sqlite3 with parameterized queries only.
"""

from __future__ import annotations

import sqlite3
import logging
from contextlib import contextmanager
from datetime import datetime, date
from pathlib import Path
from typing import Generator, Optional

from models import (
    Asset,
    WorkOrder,
    WorkOrderIssue,
    ImportRun,
    ImportFile,
    IngestionSource,
    EmailMetadata,
    RunStatus,
    FileStatus,
    ImportStatus,
)

logger = logging.getLogger(__name__)

# Default DB path — override by passing db_path to Database.__init__
DEFAULT_DB_PATH = Path(__file__).parent.parent / "data" / "crown_service.db"
SCHEMA_PATH = Path(__file__).parent / "schema.sql"


# ---------------------------------------------------------------------------
# Connection Context Manager
# ---------------------------------------------------------------------------

@contextmanager
def get_connection(db_path: Path) -> Generator[sqlite3.Connection, None, None]:
    """Provide a thread-safe connection with WAL mode enabled."""
    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Database Class
# ---------------------------------------------------------------------------

class Database:
    """
    Single entry point for all DB operations.
    Instantiate once per process; pass db_path to override location.
    """

    def __init__(self, db_path: Optional[Path] = None) -> None:
        self.db_path = db_path or DEFAULT_DB_PATH
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize_schema()

    # ------------------------------------------------------------------
    # Schema Setup
    # ------------------------------------------------------------------

    def _initialize_schema(self) -> None:
        """Apply schema.sql if tables don't already exist."""
        if not SCHEMA_PATH.exists():
            raise FileNotFoundError(f"Schema file not found: {SCHEMA_PATH}")
        schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")
        with get_connection(self.db_path) as conn:
            conn.executescript(schema_sql)
        logger.debug("Database schema initialized: %s", self.db_path)

    # ------------------------------------------------------------------
    # Asset Operations
    # ------------------------------------------------------------------

    def upsert_asset(self, asset: Asset) -> None:
        """
        Insert or update an asset record.
        updated_at is always refreshed on update.
        """
        now = _now()
        with get_connection(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO assets
                    (serial_number, equipment_reference, model, customer_name,
                     billing_folder, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(serial_number) DO UPDATE SET
                    equipment_reference = excluded.equipment_reference,
                    model = excluded.model,
                    customer_name = excluded.customer_name,
                    billing_folder = excluded.billing_folder,
                    updated_at = excluded.updated_at
                """,
                (
                    asset.serial_number,
                    asset.equipment_reference,
                    asset.model,
                    asset.customer_name,
                    asset.billing_folder,
                    now,
                    now,
                ),
            )
        logger.debug("Upserted asset: %s", asset.serial_number)

    def get_asset(self, serial_number: str) -> Optional[dict]:
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                "SELECT * FROM assets WHERE serial_number = ?", (serial_number,)
            ).fetchone()
        return dict(row) if row else None

    def search_assets(self, query: str, limit: int = 50) -> list[dict]:
        """Search by serial_number or equipment_reference (partial match)."""
        pattern = f"%{query}%"
        with get_connection(self.db_path) as conn:
            rows = conn.execute(
                """
                SELECT * FROM v_asset_service_summary
                WHERE serial_number LIKE ?
                   OR equipment_reference LIKE ?
                ORDER BY last_service_date DESC
                LIMIT ?
                """,
                (pattern, pattern, limit),
            ).fetchall()
        return [dict(r) for r in rows]

    # ------------------------------------------------------------------
    # Work Order Operations
    # ------------------------------------------------------------------

    def upsert_work_order(self, wo: WorkOrder) -> None:
        """
        Insert or update a work order.
        If same work_order_no already exists, all fields are updated.
        """
        now = _now()
        with get_connection(self.db_path) as conn:
            # Check for hash collision on re-import (different content, same WO number)
            existing = conn.execute(
                "SELECT source_file_hash FROM work_orders WHERE work_order_no = ?",
                (wo.work_order_no,),
            ).fetchone()
            dup_warning = 0
            if existing and existing[0] and existing[0] != wo.source_file_hash:
                dup_warning = 1
                logger.warning(
                    "Hash collision for WO %s: existing=%s new=%s",
                    wo.work_order_no,
                    existing[0][:12],
                    (wo.source_file_hash or "")[:12],
                )

            conn.execute(
                """
                INSERT INTO work_orders (
                    work_order_no, work_order_type, date_completed, technician,
                    serial_number, equipment_reference, model, equipment_hours,
                    total_labor_hours, service_request_description, service_performed,
                    repair_action_label, problem_note_flag, repeat_asset_key,
                    repeat_issue_signature, source_file_name, source_file_hash,
                    imported_at, import_status, parser_confidence, duplicate_hash_warning
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(work_order_no) DO UPDATE SET
                    work_order_type             = excluded.work_order_type,
                    date_completed              = excluded.date_completed,
                    technician                  = excluded.technician,
                    serial_number               = excluded.serial_number,
                    equipment_reference         = excluded.equipment_reference,
                    model                       = excluded.model,
                    equipment_hours             = excluded.equipment_hours,
                    total_labor_hours           = excluded.total_labor_hours,
                    service_request_description = excluded.service_request_description,
                    service_performed           = excluded.service_performed,
                    repair_action_label         = excluded.repair_action_label,
                    problem_note_flag           = excluded.problem_note_flag,
                    repeat_asset_key            = excluded.repeat_asset_key,
                    repeat_issue_signature      = excluded.repeat_issue_signature,
                    source_file_name            = excluded.source_file_name,
                    source_file_hash            = excluded.source_file_hash,
                    imported_at                 = excluded.imported_at,
                    import_status               = excluded.import_status,
                    parser_confidence           = excluded.parser_confidence,
                    duplicate_hash_warning      = excluded.duplicate_hash_warning
                """,
                (
                    wo.work_order_no,
                    wo.work_order_type,
                    _date_str(wo.date_completed),
                    wo.technician,
                    wo.serial_number,
                    wo.equipment_reference,
                    wo.model,
                    wo.equipment_hours,
                    wo.total_labor_hours,
                    wo.service_request_description,
                    wo.service_performed,
                    wo.repair_action_label,
                    1 if wo.problem_note_flag else 0,
                    wo.repeat_asset_key,
                    wo.repeat_issue_signature,
                    wo.source_file_name,
                    wo.source_file_hash,
                    now,
                    wo.import_status,
                    wo.parser_confidence,
                    dup_warning,
                ),
            )
        logger.debug("Upserted work order: %s  status=%s", wo.work_order_no, wo.import_status)

    def get_work_orders_for_asset(self, serial_number: str) -> list[dict]:
        with get_connection(self.db_path) as conn:
            rows = conn.execute(
                """
                SELECT wo.*, GROUP_CONCAT(woi.issue_code) as issues
                FROM work_orders wo
                LEFT JOIN work_order_issues woi ON wo.work_order_no = woi.work_order_no
                WHERE wo.serial_number = ?
                GROUP BY wo.work_order_no
                ORDER BY wo.date_completed DESC
                """,
                (serial_number,),
            ).fetchall()
        return [dict(r) for r in rows]

    def get_work_orders_filtered(
        self,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        issue_code: Optional[str] = None,
        technician: Optional[str] = None,
        limit: int = 200,
    ) -> list[dict]:
        conditions: list[str] = []
        params: list = []

        if date_from:
            conditions.append("wo.date_completed >= ?")
            params.append(date_from)
        if date_to:
            conditions.append("wo.date_completed <= ?")
            params.append(date_to)
        if technician:
            conditions.append("wo.technician LIKE ?")
            params.append(f"%{technician}%")
        if issue_code:
            conditions.append(
                "wo.work_order_no IN "
                "(SELECT work_order_no FROM work_order_issues WHERE issue_code = ?)"
            )
            params.append(issue_code)

        where_clause = ("WHERE " + " AND ".join(conditions)) if conditions else ""
        params.append(limit)

        sql = f"""
            SELECT wo.*, GROUP_CONCAT(woi.issue_code) as issues
            FROM work_orders wo
            LEFT JOIN work_order_issues woi ON wo.work_order_no = woi.work_order_no
            {where_clause}
            GROUP BY wo.work_order_no
            ORDER BY wo.date_completed DESC
            LIMIT ?
        """
        with get_connection(self.db_path) as conn:
            rows = conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]

    # ------------------------------------------------------------------
    # Issue Operations
    # ------------------------------------------------------------------

    def replace_issues_for_work_order(
        self, work_order_no: str, issue_codes: list[str]
    ) -> None:
        """
        Delete all existing issues for a work order and reinsert.
        Called after upsert_work_order to keep issues in sync.
        """
        with get_connection(self.db_path) as conn:
            conn.execute(
                "DELETE FROM work_order_issues WHERE work_order_no = ?",
                (work_order_no,),
            )
            now = _now()
            for code in issue_codes:
                conn.execute(
                    "INSERT INTO work_order_issues (work_order_no, issue_code, created_at) VALUES (?, ?, ?)",
                    (work_order_no, code, now),
                )
        logger.debug(
            "Replaced %d issues for work order: %s", len(issue_codes), work_order_no
        )

    def get_issue_frequency(
        self, date_from: Optional[str] = None, date_to: Optional[str] = None
    ) -> list[dict]:
        params: list = []
        date_filter = ""
        if date_from or date_to:
            joins = " JOIN work_orders wo ON woi.work_order_no = wo.work_order_no "
            clauses = []
            if date_from:
                clauses.append("wo.date_completed >= ?")
                params.append(date_from)
            if date_to:
                clauses.append("wo.date_completed <= ?")
                params.append(date_to)
            date_filter = joins + "WHERE " + " AND ".join(clauses)

        sql = f"""
            SELECT woi.issue_code, COUNT(*) as count
            FROM work_order_issues woi
            {date_filter}
            GROUP BY woi.issue_code
            ORDER BY count DESC
        """
        with get_connection(self.db_path) as conn:
            rows = conn.execute(sql, params).fetchall()
        return [dict(r) for r in rows]

    def get_issues_per_asset(self) -> list[dict]:
        with get_connection(self.db_path) as conn:
            rows = conn.execute(
                """
                SELECT wo.serial_number, wo.equipment_reference, woi.issue_code,
                       COUNT(*) as count
                FROM work_order_issues woi
                JOIN work_orders wo ON woi.work_order_no = wo.work_order_no
                GROUP BY wo.serial_number, wo.equipment_reference, woi.issue_code
                ORDER BY count DESC
                """
            ).fetchall()
        return [dict(r) for r in rows]

    def get_problem_assets(self, limit: int = 50) -> list[dict]:
        with get_connection(self.db_path) as conn:
            rows = conn.execute(
                "SELECT * FROM v_repeat_problem_assets LIMIT ?", (limit,)
            ).fetchall()
        return [dict(r) for r in rows]

    # ------------------------------------------------------------------
    # Import Run Tracking
    # ------------------------------------------------------------------

    def create_import_run(self) -> int:
        """Open a new import run and return its ID."""
        now = _now()
        with get_connection(self.db_path) as conn:
            cursor = conn.execute(
                "INSERT INTO import_runs (started_at, status) VALUES (?, ?)",
                (now, RunStatus.RUNNING),
            )
            run_id = cursor.lastrowid
        logger.info("Import run started: id=%d", run_id)
        return run_id

    def close_import_run(
        self, run_id: int, files_processed: int, files_failed: int
    ) -> None:
        status = RunStatus.COMPLETED if files_failed == 0 else RunStatus.COMPLETED
        # Still mark completed even with failures — failures are tracked per-file
        with get_connection(self.db_path) as conn:
            conn.execute(
                """
                UPDATE import_runs
                SET completed_at = ?, files_processed = ?, files_failed = ?, status = ?
                WHERE id = ?
                """,
                (_now(), files_processed, files_failed, status, run_id),
            )
        logger.info(
            "Import run closed: id=%d processed=%d failed=%d",
            run_id, files_processed, files_failed,
        )

    def is_file_already_processed(self, file_hash: str) -> bool:
        """Return True if this exact file (by hash) was already successfully imported."""
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                "SELECT id FROM import_files WHERE file_hash = ? AND status = 'processed' LIMIT 1",
                (file_hash,),
            ).fetchone()
        return row is not None

    def get_recent_import_runs(self, limit: int = 20) -> list[dict]:
        with get_connection(self.db_path) as conn:
            rows = conn.execute(
                "SELECT * FROM import_runs ORDER BY started_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return [dict(r) for r in rows]

    # ------------------------------------------------------------------
    # Dashboard Summary Queries
    # ------------------------------------------------------------------

    def get_dashboard_stats(self) -> dict:
        with get_connection(self.db_path) as conn:
            stats = {}
            stats["total_assets"] = conn.execute(
                "SELECT COUNT(*) FROM assets"
            ).fetchone()[0]
            stats["total_work_orders"] = conn.execute(
                "SELECT COUNT(*) FROM work_orders"
            ).fetchone()[0]
            stats["total_issues"] = conn.execute(
                "SELECT COUNT(*) FROM work_order_issues"
            ).fetchone()[0]
            stats["problem_assets"] = conn.execute(
                "SELECT COUNT(*) FROM v_repeat_problem_assets"
            ).fetchone()[0]
            stats["last_import"] = conn.execute(
                "SELECT MAX(completed_at) FROM import_runs WHERE status = 'completed'"
            ).fetchone()[0]
        return stats

    def get_all_technicians(self) -> list[str]:
        with get_connection(self.db_path) as conn:
            rows = conn.execute(
                "SELECT DISTINCT technician FROM work_orders WHERE technician IS NOT NULL ORDER BY technician"
            ).fetchall()
        return [r[0] for r in rows]

    # ------------------------------------------------------------------
    # Ingestion Source Operations (v2)
    # ------------------------------------------------------------------

    def list_ingestion_sources(self) -> list[dict]:
        with get_connection(self.db_path) as conn:
            rows = conn.execute(
                "SELECT * FROM ingestion_sources ORDER BY id"
            ).fetchall()
        return [dict(r) for r in rows]

    def get_ingestion_source(self, source_id: int) -> Optional[dict]:
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                "SELECT * FROM ingestion_sources WHERE id = ?", (source_id,)
            ).fetchone()
        return dict(row) if row else None

    def create_ingestion_source(self, source: IngestionSource) -> int:
        now = _now()
        with get_connection(self.db_path) as conn:
            cursor = conn.execute(
                """
                INSERT INTO ingestion_sources
                    (name, folder_path, enabled, allowed_types,
                     processed_folder, failed_folder, recursive, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    source.name, source.folder_path, 1 if source.enabled else 0,
                    source.allowed_types, source.processed_folder,
                    source.failed_folder, 1 if source.recursive else 0,
                    now, now,
                ),
            )
            return cursor.lastrowid

    def update_ingestion_source(self, source_id: int, data: dict) -> None:
        """Update mutable fields on an ingestion source."""
        now = _now()
        allowed_keys = {
            "name", "folder_path", "enabled", "allowed_types",
            "processed_folder", "failed_folder", "recursive",
        }
        updates = {k: v for k, v in data.items() if k in allowed_keys}
        if not updates:
            return
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        params = list(updates.values()) + [now, source_id]
        with get_connection(self.db_path) as conn:
            conn.execute(
                f"UPDATE ingestion_sources SET {set_clause}, updated_at = ? WHERE id = ?",
                params,
            )

    def delete_ingestion_source(self, source_id: int) -> None:
        with get_connection(self.db_path) as conn:
            conn.execute(
                "DELETE FROM ingestion_sources WHERE id = ?", (source_id,)
            )

    def get_enabled_ingestion_sources(self) -> list[dict]:
        with get_connection(self.db_path) as conn:
            rows = conn.execute(
                "SELECT * FROM ingestion_sources WHERE enabled = 1 ORDER BY id"
            ).fetchall()
        return [dict(r) for r in rows]

    # ------------------------------------------------------------------
    # Email Metadata Operations (v2)
    # ------------------------------------------------------------------

    def upsert_email_metadata(self, meta: EmailMetadata) -> None:
        with get_connection(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO email_metadata
                    (import_file_id, subject, sender, sent_date, attachment_filename)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(import_file_id) DO UPDATE SET
                    subject             = excluded.subject,
                    sender              = excluded.sender,
                    sent_date           = excluded.sent_date,
                    attachment_filename = excluded.attachment_filename
                """,
                (
                    meta.import_file_id, meta.subject,
                    meta.sender, meta.sent_date, meta.attachment_filename,
                ),
            )

    def get_email_metadata_for_file(self, import_file_id: int) -> Optional[dict]:
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                "SELECT * FROM email_metadata WHERE import_file_id = ?",
                (import_file_id,),
            ).fetchone()
        return dict(row) if row else None

    # ------------------------------------------------------------------
    # Import File (v2 updates)
    # ------------------------------------------------------------------

    def create_import_file(
        self, run_id: int, file_name: str, file_path: str,
        ingestion_source_id: Optional[int] = None,
    ) -> int:
        with get_connection(self.db_path) as conn:
            cursor = conn.execute(
                """
                INSERT INTO import_files
                    (import_run_id, ingestion_source_id, file_name, file_path, status)
                VALUES (?, ?, ?, ?, ?)
                """,
                (run_id, ingestion_source_id, file_name, file_path, FileStatus.PENDING),
            )
            return cursor.lastrowid

    def update_import_file(
        self,
        file_id: int,
        status: str,
        file_hash: Optional[str] = None,
        error_message: Optional[str] = None,
        work_order_no: Optional[str] = None,
    ) -> None:
        with get_connection(self.db_path) as conn:
            conn.execute(
                """
                UPDATE import_files
                SET status = ?, file_hash = ?, error_message = ?,
                    processed_at = ?, work_order_no = ?
                WHERE id = ?
                """,
                (status, file_hash, error_message, _now(), work_order_no, file_id),
            )

    def get_import_files_for_run(self, run_id: int) -> list[dict]:
        with get_connection(self.db_path) as conn:
            rows = conn.execute(
                """
                SELECT imf.*, em.subject, em.sender, em.attachment_filename,
                       src.name as source_name
                FROM import_files imf
                LEFT JOIN email_metadata em ON em.import_file_id = imf.id
                LEFT JOIN ingestion_sources src ON src.id = imf.ingestion_source_id
                WHERE imf.import_run_id = ?
                ORDER BY imf.id
                """,
                (run_id,),
            ).fetchall()
        return [dict(r) for r in rows]

    def get_recent_import_files(self, limit: int = 100) -> list[dict]:
        """Return recent import file records across all runs."""
        with get_connection(self.db_path) as conn:
            rows = conn.execute(
                """
                SELECT imf.*, em.subject, em.sender, em.attachment_filename,
                       src.name as source_name,
                       ir.started_at as run_started_at
                FROM import_files imf
                LEFT JOIN email_metadata em ON em.import_file_id = imf.id
                LEFT JOIN ingestion_sources src ON src.id = imf.ingestion_source_id
                LEFT JOIN import_runs ir ON ir.id = imf.import_run_id
                ORDER BY imf.id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [dict(r) for r in rows]

    # ------------------------------------------------------------------
    # Review Workflow Operations (v2)
    # ------------------------------------------------------------------

    def get_needs_review(self) -> list[dict]:
        with get_connection(self.db_path) as conn:
            rows = conn.execute(
                "SELECT * FROM v_needs_review"
            ).fetchall()
        return [dict(r) for r in rows]

    def update_work_order_review(
        self,
        work_order_no: str,
        updates: dict,
        reviewed_by: str,
    ) -> None:
        """
        Apply manual corrections to a work order and mark it reviewed.
        `updates` may include: serial_number, equipment_reference, model,
        review_notes, import_status.
        """
        allowed = {
            "serial_number", "equipment_reference", "model",
            "review_notes", "import_status",
        }
        safe = {k: v for k, v in updates.items() if k in allowed}
        if not safe:
            return
        safe["reviewed_by"] = reviewed_by
        safe["reviewed_at"] = _now()
        set_clause = ", ".join(f"{k} = ?" for k in safe)
        params = list(safe.values()) + [work_order_no]
        with get_connection(self.db_path) as conn:
            conn.execute(
                f"UPDATE work_orders SET {set_clause} WHERE work_order_no = ?",
                params,
            )
        logger.info("WO %s reviewed by %s", work_order_no, reviewed_by)

    def replace_issues_and_recompute(
        self, work_order_no: str, issue_codes: list[str]
    ) -> None:
        """Re-run issue replacement and update repeat_issue_signature."""
        signature = "|".join(sorted(issue_codes)) if issue_codes else None
        with get_connection(self.db_path) as conn:
            conn.execute(
                "DELETE FROM work_order_issues WHERE work_order_no = ?",
                (work_order_no,),
            )
            now = _now()
            for code in issue_codes:
                conn.execute(
                    "INSERT INTO work_order_issues (work_order_no, issue_code, created_at) VALUES (?, ?, ?)",
                    (work_order_no, code, now),
                )
            conn.execute(
                "UPDATE work_orders SET repeat_issue_signature = ? WHERE work_order_no = ?",
                (signature, work_order_no),
            )

    def get_work_order_detail(self, work_order_no: str) -> Optional[dict]:
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                """
                SELECT wo.*, GROUP_CONCAT(woi.issue_code) as issues
                FROM work_orders wo
                LEFT JOIN work_order_issues woi ON wo.work_order_no = woi.work_order_no
                WHERE wo.work_order_no = ?
                GROUP BY wo.work_order_no
                """,
                (work_order_no,),
            ).fetchone()
        return dict(row) if row else None

    def get_asset_detail(self, serial_number: str) -> Optional[dict]:
        """Full asset detail with PM/W counts and issue summary."""
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                "SELECT * FROM v_asset_service_summary WHERE serial_number = ?",
                (serial_number,),
            ).fetchone()
        return dict(row) if row else None

    def get_issue_counts_for_asset(self, serial_number: str) -> list[dict]:
        with get_connection(self.db_path) as conn:
            rows = conn.execute(
                """
                SELECT woi.issue_code, COUNT(*) as count
                FROM work_order_issues woi
                JOIN work_orders wo ON woi.work_order_no = wo.work_order_no
                WHERE wo.serial_number = ?
                GROUP BY woi.issue_code
                ORDER BY count DESC
                """,
                (serial_number,),
            ).fetchall()
        return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now() -> str:
    return datetime.utcnow().isoformat(sep=" ", timespec="seconds")


def _date_str(d: Optional[date]) -> Optional[str]:
    return d.isoformat() if d else None
