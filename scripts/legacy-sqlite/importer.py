"""
importer.py - File ingestion orchestrator for Crown Service Equipment Tracking.

Responsibilities:
- Scan a specified network folder for PDF and MSG files
- Dispatch each file to parser.py for text extraction and field parsing
- Validate and normalize ParsedDocument fields via validator.py
- Write records to SQLite via db.py
- Move files to Processed/ or Failed/ subfolders based on outcome
- Record per-file results in import_files table
- Log everything to rotating log file and stdout

Usage (command line):
    python importer.py --folder "\\\\dennis.com\\shares\\...\\Incoming" --db ./data/crown_service.db
    python importer.py --folder /path/to/Incoming --once
    python importer.py --folder /path/to/Incoming --watch --interval 300

Usage (programmatic):
    from importer import run_import
    run_import(folder=Path("/path/to/Incoming"), db=Database())
"""

from __future__ import annotations

import argparse
import logging
import shutil
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

from db import Database
from models import FileStatus, ImportStatus, ParsedDocument, IngestionSource
from parser import parse_file
from validator import validate_parsed_document

logger = logging.getLogger(__name__)

# Default supported extensions — overridden per-source by IngestionSource.allowed_extensions
SUPPORTED_EXTENSIONS = {".pdf", ".eml", ".msg"}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def run_import(
    folder: Path,
    db: Database,
    move_files: bool = True,
    source_id: Optional[int] = None,
) -> dict:
    """
    Scan `folder` for new service files, parse them, and write to DB.

    folder_path, processed_dir, failed_dir, and allowed_extensions are
    derived from the IngestionSource record when source_id is provided.
    Otherwise they fall back to legacy defaults.

    Returns a summary dict:
        {
            "run_id": int,
            "processed": int,
            "needs_review": int,
            "failed": int,
            "skipped": int,
            "files": [{"name": str, "status": str, "error": str|None, "work_order_no": str|None}]
        }
    """
    incoming_dir = folder.resolve()

    # Resolve processed/failed dirs from DB source config or legacy defaults
    source_row: Optional[dict] = None
    allowed_extensions = SUPPORTED_EXTENSIONS
    processed_dir_default = incoming_dir.parent / "Processed"
    failed_dir_default = incoming_dir.parent / "Failed"
    recursive = False

    if source_id is not None:
        source_row = db.get_ingestion_source(source_id)
        if source_row:
            allowed_extensions = {
                ext.strip().lower()
                for ext in (source_row.get("allowed_types") or ".pdf,.eml,.msg").split(",")
            }
            if source_row.get("processed_folder"):
                processed_dir_default = Path(source_row["processed_folder"])
            if source_row.get("failed_folder"):
                failed_dir_default = Path(source_row["failed_folder"])
            recursive = bool(source_row.get("recursive", 0))

    if not incoming_dir.exists():
        raise FileNotFoundError(f"Incoming folder does not exist: {incoming_dir}")

    processed_dir_default.mkdir(parents=True, exist_ok=True)
    failed_dir_default.mkdir(parents=True, exist_ok=True)

    run_id = db.create_import_run()
    logger.info("=" * 60)
    logger.info("Import run started: id=%d  source_id=%s  folder=%s", run_id, source_id, incoming_dir)

    files = _collect_files(incoming_dir, allowed_extensions, recursive)
    logger.info("Found %d file(s) to process", len(files))

    results: dict = {
        "run_id": run_id,
        "processed": 0,
        "needs_review": 0,
        "failed": 0,
        "skipped": 0,
        "files": [],
    }

    for file_path in files:
        file_result = _process_single_file(
            file_path=file_path,
            run_id=run_id,
            db=db,
            processed_dir=processed_dir_default,
            failed_dir=failed_dir_default,
            move_files=move_files,
            ingestion_source_id=source_id,
        )

        results["files"].append(file_result)
        st = file_result["status"]
        if st == FileStatus.PROCESSED:
            results["processed"] += 1
        elif st == FileStatus.NEEDS_REVIEW:
            results["needs_review"] += 1
        elif st == FileStatus.SKIPPED:
            results["skipped"] += 1
        else:
            results["failed"] += 1

    db.close_import_run(
        run_id=run_id,
        files_processed=results["processed"] + results["needs_review"],
        files_failed=results["failed"],
    )

    logger.info(
        "Import run complete: id=%d  processed=%d  needs_review=%d  failed=%d  skipped=%d",
        run_id, results["processed"], results["needs_review"],
        results["failed"], results["skipped"],
    )
    logger.info("=" * 60)
    return results


def run_import_all_sources(db: Database, move_files: bool = True) -> list[dict]:
    """
    Run import against all enabled ingestion sources.
    Returns a list of per-source result dicts.
    """
    sources = db.get_enabled_ingestion_sources()
    if not sources:
        logger.warning("No enabled ingestion sources found. Add sources via the Settings UI.")
        return []
    summaries = []
    for src in sources:
        logger.info("Processing source: %s  (%s)", src["name"], src["folder_path"])
        try:
            result = run_import(
                folder=Path(src["folder_path"]),
                db=db,
                move_files=move_files,
                source_id=src["id"],
            )
            result["source_name"] = src["name"]
            summaries.append(result)
        except Exception as e:
            logger.error("Source %r failed: %s", src["name"], e, exc_info=True)
            summaries.append({"source_name": src["name"], "error": str(e)})
    return summaries


# ---------------------------------------------------------------------------
# Single File Processing
# ---------------------------------------------------------------------------

def _process_single_file(
    file_path: Path,
    run_id: int,
    db: Database,
    processed_dir: Path,
    failed_dir: Path,
    move_files: bool,
    ingestion_source_id: Optional[int] = None,
) -> dict:
    """
    Process one file end-to-end.
    Returns a dict: {name, status, error, work_order_no}
    """
    file_id = db.create_import_file(
        run_id=run_id,
        file_name=file_path.name,
        file_path=str(file_path),
        ingestion_source_id=ingestion_source_id,
    )

    logger.info("Processing: %s", file_path.name)
    db.update_import_file(file_id, FileStatus.PROCESSING)

    try:
        # Step 1: Parse document
        doc: ParsedDocument = parse_file(file_path)

        # Step 2: Check for duplicate by file hash
        if db.is_file_already_processed(doc.source_file_hash):
            logger.info("  SKIP (already imported): %s  hash=%s", file_path.name, doc.source_file_hash[:12])
            db.update_import_file(
                file_id,
                status=FileStatus.SKIPPED,
                file_hash=doc.source_file_hash,
                error_message="Duplicate file hash — already imported.",
            )
            if move_files:
                _move_file(file_path, _unique_path(processed_dir / file_path.name))
            return {"name": file_path.name, "status": FileStatus.SKIPPED, "error": None, "work_order_no": None}

        # Log parse warnings (non-fatal)
        for warn in doc.parse_warnings:
            logger.warning("  Parse warning [%s]: %s", file_path.name, warn)

        # Step 3: Validate fields (hard failures only — soft failures handled by confidence)
        validation_errors = validate_parsed_document(doc)
        if validation_errors:
            for err in validation_errors:
                logger.error("  Validation error [%s]: %s", file_path.name, err)
            raise ValueError(f"Validation failed: {'; '.join(validation_errors)}")

        # Step 4: Write to database (asset + work order + issues)
        _write_to_database(doc, db)

        # Step 5: Save email metadata if present
        if doc.email_metadata is not None:
            doc.email_metadata.import_file_id = file_id
            db.upsert_email_metadata(doc.email_metadata)

        # Step 6: Determine file-level status from work order import_status
        wo_status = doc.work_order.import_status
        file_status = (
            FileStatus.NEEDS_REVIEW if wo_status == ImportStatus.NEEDS_REVIEW
            else FileStatus.PROCESSED
        )

        db.update_import_file(
            file_id,
            status=file_status,
            file_hash=doc.source_file_hash,
            work_order_no=doc.work_order.work_order_no,
        )

        if move_files:
            dest = _unique_path(processed_dir / file_path.name)
            _move_file(file_path, dest)

        logger.info(
            "  %s: WO=%s  serial=%s  confidence=%.2f  issues=%s",
            file_status.upper(),
            doc.work_order.work_order_no,
            doc.work_order.serial_number,
            doc.parser_confidence,
            ",".join(doc.work_order.issues) or "none",
        )
        return {
            "name": file_path.name,
            "status": file_status,
            "error": None,
            "work_order_no": doc.work_order.work_order_no,
        }

    except Exception as exc:
        error_msg = str(exc)
        logger.error("  FAILED [%s]: %s", file_path.name, error_msg, exc_info=True)

        db.update_import_file(
            file_id,
            status=FileStatus.FAILED,
            error_message=error_msg,
        )

        if move_files:
            dest = _unique_path(failed_dir / file_path.name)
            _move_file(file_path, dest)

        return {"name": file_path.name, "status": FileStatus.FAILED, "error": error_msg, "work_order_no": None}


# ---------------------------------------------------------------------------
# Database Write
# ---------------------------------------------------------------------------

def _write_to_database(doc: ParsedDocument, db: Database) -> None:
    """
    Persist a validated ParsedDocument to the database.
    Order matters: asset must exist before work_order (FK constraint).
    """
    # 1. Upsert asset
    db.upsert_asset(doc.asset)

    # 2. Upsert work order
    db.upsert_work_order(doc.work_order)

    # 3. Replace issue records (handles re-imports cleanly)
    db.replace_issues_for_work_order(
        work_order_no=doc.work_order.work_order_no,
        issue_codes=doc.work_order.issues,
    )

    logger.debug(
        "DB write complete: WO=%s  asset=%s",
        doc.work_order.work_order_no,
        doc.asset.serial_number,
    )


# ---------------------------------------------------------------------------
# File System Helpers
# ---------------------------------------------------------------------------

def _collect_files(
    folder: Path,
    extensions: set[str] = SUPPORTED_EXTENSIONS,
    recursive: bool = False,
) -> list[Path]:
    """
    Return all supported files in folder.
    Sorted by modification time (oldest first) for consistent processing order.
    """
    glob_fn = folder.rglob if recursive else folder.glob
    files = [
        f for f in glob_fn("*")
        if f.is_file() and f.suffix.lower() in extensions
    ]
    files.sort(key=lambda f: f.stat().st_mtime)
    return files


def _move_file(src: Path, dest: Path) -> None:
    """Move a file, creating destination parent if needed."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        shutil.move(str(src), str(dest))
        logger.debug("  Moved: %s → %s", src.name, dest.parent.name)
    except Exception as e:
        logger.warning("  Could not move file %s: %s", src.name, e)


def _unique_path(dest: Path) -> Path:
    """If destination already exists, append a timestamp to avoid overwriting."""
    if not dest.exists():
        return dest
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    return dest.parent / f"{dest.stem}_{ts}{dest.suffix}"


# ---------------------------------------------------------------------------
# Watch Mode
# ---------------------------------------------------------------------------

def watch_folder(folder: Path, db: Database, interval_seconds: int = 300) -> None:
    """
    Continuously poll the folder and run imports on an interval.
    Intended for use as a background service (systemd, Windows Task Scheduler, etc.)
    Stop with Ctrl+C.
    """
    logger.info("Watch mode started. Polling every %ds. Ctrl+C to stop.", interval_seconds)
    while True:
        try:
            run_import(folder=folder, db=db)
        except Exception as e:
            logger.error("Unhandled error in watch loop: %s", e, exc_info=True)
        logger.info("Next scan in %d seconds...", interval_seconds)
        time.sleep(interval_seconds)


# ---------------------------------------------------------------------------
# CLI Entry Point
# ---------------------------------------------------------------------------


def _setup_logging(level: str, log_dir: Path) -> None:
    """Configure root logger: rotating file + stdout."""
    import logging.handlers

    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "importer.log"

    fmt = "%(asctime)s %(levelname)-8s %(name)s  %(message)s"
    datefmt = "%Y-%m-%d %H:%M:%S"
    formatter = logging.Formatter(fmt, datefmt=datefmt)

    # Rotating file handler — max 5MB × 5 backups
    file_handler = logging.handlers.RotatingFileHandler(
        log_file, maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8"
    )
    file_handler.setFormatter(formatter)

    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)

    root = logging.getLogger()
    root.setLevel(getattr(logging, level))
    root.addHandler(file_handler)
    root.addHandler(console_handler)

    logger.info("Logging initialized. Level=%s  File=%s", level, log_file)


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Crown Service Equipment Tracking — File Importer v2",
    )
    # Mutually exclusive: either supply --folder (legacy) or --all-sources
    group = p.add_mutually_exclusive_group()
    group.add_argument("--folder", help="Path to a specific Incoming folder to scan.")
    group.add_argument("--all-sources", action="store_true",
                       help="Import from all enabled ingestion sources in the DB.")
    p.add_argument("--source-id", type=int, default=None,
                   help="Ingestion source ID (used with --folder to link file records to a source).")
    p.add_argument("--db", default=None, help="Path to SQLite database file.")
    p.add_argument("--watch", action="store_true",
                   help="Run continuously, polling every --interval seconds.")
    p.add_argument("--interval", type=int, default=300,
                   help="Poll interval in seconds for watch mode (default: 300).")
    p.add_argument("--dry-run", action="store_true",
                   help="Parse and validate files but do not write to DB or move files.")
    p.add_argument("--no-move", action="store_true",
                   help="Do not move files after processing.")
    p.add_argument("--log-level", choices=["DEBUG","INFO","WARNING","ERROR"], default="INFO")
    return p


if __name__ == "__main__":
    args = _build_parser().parse_args()

    db_path = Path(args.db) if args.db else None
    log_dir = (db_path.parent if db_path else Path("data")) / "logs"
    _setup_logging(args.log_level, log_dir)
    db = Database(db_path=db_path)
    move_files = not args.no_move

    if args.dry_run:
        folder = Path(args.folder) if args.folder else None
        if not folder:
            logger.error("--dry-run requires --folder")
        else:
            logger.info("DRY RUN mode — no DB writes or file moves.")
            files = _collect_files(folder.resolve())
            for f in files:
                try:
                    doc = parse_file(f)
                    errs = validate_parsed_document(doc)
                    if errs:
                        logger.error("  INVALID [%s]: %s", f.name, "; ".join(errs))
                    else:
                        logger.info(
                            "  VALID [%s]: WO=%s  serial=%s  confidence=%.2f",
                            f.name, doc.work_order.work_order_no,
                            doc.work_order.serial_number, doc.parser_confidence,
                        )
                except Exception as e:
                    logger.error("  PARSE ERROR [%s]: %s", f.name, e)

    elif args.all_sources:
        if args.watch:
            logger.info("Watch mode (all sources). Polling every %ds.", args.interval)
            while True:
                try:
                    run_import_all_sources(db=db, move_files=move_files)
                except Exception as e:
                    logger.error("Error in watch loop: %s", e, exc_info=True)
                time.sleep(args.interval)
        else:
            summaries = run_import_all_sources(db=db, move_files=move_files)
            for s in summaries:
                print(
                    f"  Source: {s.get('source_name')}  "
                    f"processed={s.get('processed',0)}  "
                    f"needs_review={s.get('needs_review',0)}  "
                    f"failed={s.get('failed',0)}  "
                    f"skipped={s.get('skipped',0)}"
                )

    elif args.folder:
        folder = Path(args.folder)
        if args.watch:
            watch_folder(folder=folder, db=db, interval_seconds=args.interval)
        else:
            summary = run_import(folder=folder, db=db, move_files=move_files, source_id=args.source_id)
            print(
                f"\nSummary: processed={summary['processed']}  "
                f"needs_review={summary['needs_review']}  "
                f"failed={summary['failed']}  skipped={summary['skipped']}"
            )
    else:
        logger.error("Provide --folder or --all-sources")
