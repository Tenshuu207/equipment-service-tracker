"""
init_db.py — Initialize or reset the Crown Service SQLite database.

Run this once before using the importer. Safe to re-run (uses IF NOT EXISTS).

Usage:
    python init_db.py
    python init_db.py --db ./data/crown_service.db
    python init_db.py --reset   # WARNING: drops and recreates all tables
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


def init_database(db_path: Path, reset: bool = False) -> None:
    from db import Database, get_connection
    from pathlib import Path

    schema_path = Path(__file__).parent / "schema.sql"
    if not schema_path.exists():
        logger.error("schema.sql not found at: %s", schema_path)
        sys.exit(1)

    db_path.parent.mkdir(parents=True, exist_ok=True)

    if reset and db_path.exists():
        logger.warning("RESET requested — removing existing database: %s", db_path)
        db_path.unlink()
        logger.info("Existing database removed.")

    logger.info("Initializing database: %s", db_path)

    db = Database(db_path=db_path)
    stats = db.get_dashboard_stats()

    logger.info("Database ready.")
    logger.info(
        "  Tables: assets=%d  work_orders=%d  issues=%d",
        stats["total_assets"],
        stats["total_work_orders"],
        stats["total_issues"],
    )


def main() -> None:
    p = argparse.ArgumentParser(description="Initialize Crown Service database.")
    p.add_argument("--db", default="./data/crown_service.db", help="Path to DB file.")
    p.add_argument(
        "--reset",
        action="store_true",
        help="Drop and recreate the database. WARNING: destroys all data.",
    )
    args = p.parse_args()

    if args.reset:
        confirm = input("This will DELETE all data. Type 'yes' to confirm: ")
        if confirm.strip().lower() != "yes":
            logger.info("Reset cancelled.")
            return

    init_database(Path(args.db), reset=args.reset)


if __name__ == "__main__":
    main()
