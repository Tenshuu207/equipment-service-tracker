-- =============================================================================
-- Crown Service Tracker — Schema v2 Migration
-- Run this ONCE against an existing v1 database to add new tables/columns.
-- The main schema.sql has also been updated to reflect v2 for fresh installs.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Ingestion Sources — configurable folder-based import sources
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingestion_sources (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    folder_path TEXT NOT NULL,
    enabled     BOOLEAN NOT NULL DEFAULT 1,
    allowed_types TEXT NOT NULL DEFAULT '.pdf,.eml,.msg',  -- comma-separated
    processed_folder TEXT,   -- NULL = auto: <folder_path>/../Processed
    failed_folder    TEXT,   -- NULL = auto: <folder_path>/../Failed
    recursive   BOOLEAN NOT NULL DEFAULT 0,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed a default source so the system starts pre-configured
INSERT OR IGNORE INTO ingestion_sources
    (name, folder_path, enabled, allowed_types, recursive)
VALUES
    (
        'Crown Incoming',
        '\\dennis.com\shares\Operations Shared Files\Day Warehouse\Warehouse Equipment\Crown Service Tracking\Incoming',
        1,
        '.pdf,.eml,.msg',
        0
    );

-- ---------------------------------------------------------------------------
-- 2. Email metadata — stored when source file is a .eml
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_metadata (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    import_file_id    INTEGER NOT NULL UNIQUE,
    subject           TEXT,
    sender            TEXT,
    sent_date         TEXT,
    attachment_filename TEXT,
    FOREIGN KEY (import_file_id) REFERENCES import_files(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_email_import_file ON email_metadata(import_file_id);

-- ---------------------------------------------------------------------------
-- 3. New columns on work_orders
-- ---------------------------------------------------------------------------

-- Import status: processed | needs_review | failed
-- Added as a new column with a default so existing rows get 'processed'.
ALTER TABLE work_orders ADD COLUMN import_status TEXT NOT NULL DEFAULT 'processed'
    CHECK(import_status IN ('processed', 'needs_review', 'failed'));

-- Manual review / correction tracking
ALTER TABLE work_orders ADD COLUMN reviewed_by   TEXT;
ALTER TABLE work_orders ADD COLUMN reviewed_at   TIMESTAMP;
ALTER TABLE work_orders ADD COLUMN review_notes  TEXT;

-- Parser confidence level (0.0–1.0, lower = more likely to go to needs_review)
ALTER TABLE work_orders ADD COLUMN parser_confidence REAL;

-- Hash collision tracking: flag if same WO imported from different file content
ALTER TABLE work_orders ADD COLUMN duplicate_hash_warning BOOLEAN DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 4. New columns on import_files
-- ---------------------------------------------------------------------------

-- Link back to the ingestion source that produced this file
ALTER TABLE import_files ADD COLUMN ingestion_source_id INTEGER
    REFERENCES ingestion_sources(id) ON DELETE SET NULL;

-- Three-state status (extends existing 'success'/'failed' values)
-- We add 'needs_review' — existing CHECK constraint on the column must be dropped.
-- SQLite doesn't support DROP CONSTRAINT, so we recreate the table.

-- Rename old table
ALTER TABLE import_files RENAME TO import_files_old;

-- Recreate with updated CHECK
CREATE TABLE import_files (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    import_run_id       INTEGER NOT NULL,
    ingestion_source_id INTEGER,
    file_name           TEXT NOT NULL,
    file_path           TEXT,
    file_hash           TEXT,
    status              TEXT DEFAULT 'pending'
                        CHECK(status IN ('pending','processing','processed','needs_review','failed','skipped')),
    work_order_no       TEXT,   -- resulting WO number on success
    error_message       TEXT,
    processed_at        TIMESTAMP,
    FOREIGN KEY (import_run_id)       REFERENCES import_runs(id)          ON DELETE CASCADE,
    FOREIGN KEY (ingestion_source_id) REFERENCES ingestion_sources(id)    ON DELETE SET NULL
);

-- Migrate existing data
INSERT INTO import_files
    (id, import_run_id, file_name, file_path, file_hash, status, error_message, processed_at)
SELECT id, import_run_id, file_name, file_path, file_hash,
       CASE status
           WHEN 'success' THEN 'processed'
           ELSE status
       END,
       error_message, processed_at
FROM import_files_old;

DROP TABLE import_files_old;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_if_run    ON import_files(import_run_id);
CREATE INDEX IF NOT EXISTS idx_if_hash   ON import_files(file_hash);
CREATE INDEX IF NOT EXISTS idx_if_status ON import_files(status);
CREATE INDEX IF NOT EXISTS idx_if_source ON import_files(ingestion_source_id);
CREATE INDEX IF NOT EXISTS idx_if_wo     ON import_files(work_order_no);

-- ---------------------------------------------------------------------------
-- 5. New indexes on work_orders for review workflow
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_wo_import_status ON work_orders(import_status);

-- ---------------------------------------------------------------------------
-- 6. Update v_asset_service_summary view to include PM/W breakdown
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS v_asset_service_summary;
CREATE VIEW v_asset_service_summary AS
SELECT
    a.serial_number,
    a.equipment_reference,
    a.model,
    a.customer_name,
    COUNT(wo.work_order_no)                                                   AS total_work_orders,
    SUM(CASE WHEN wo.work_order_type = 'PM' THEN 1 ELSE 0 END)               AS total_pm_orders,
    SUM(CASE WHEN wo.work_order_type = 'W'  THEN 1 ELSE 0 END)               AS total_w_orders,
    SUM(wo.total_labor_hours)                                                  AS total_labor_hours,
    MAX(wo.date_completed)                                                     AS last_service_date,
    SUM(CASE WHEN wo.problem_note_flag = 1 THEN 1 ELSE 0 END)                AS problem_count,
    GROUP_CONCAT(DISTINCT wo.repeat_issue_signature)                           AS repeat_signatures
FROM assets a
LEFT JOIN work_orders wo ON a.serial_number = wo.serial_number
GROUP BY a.serial_number, a.equipment_reference, a.model, a.customer_name;

-- ---------------------------------------------------------------------------
-- 7. Needs-review queue view
-- ---------------------------------------------------------------------------
CREATE VIEW IF NOT EXISTS v_needs_review AS
SELECT
    wo.work_order_no,
    wo.import_status,
    wo.serial_number,
    wo.equipment_reference,
    wo.model,
    wo.technician,
    wo.date_completed,
    wo.source_file_name,
    wo.imported_at,
    wo.parser_confidence,
    wo.review_notes,
    imf.file_name,
    imf.error_message
FROM work_orders wo
LEFT JOIN import_files imf ON imf.work_order_no = wo.work_order_no
WHERE wo.import_status = 'needs_review'
ORDER BY wo.imported_at DESC;
