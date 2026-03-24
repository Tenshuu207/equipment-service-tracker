-- =============================================================================
-- Crown Service Equipment Management System — Database Schema v2
-- SQLite. Run init_db.py to apply. For existing databases use schema_v2_migration.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Ingestion Sources — configurable folder-based import sources (v2)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingestion_sources (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT NOT NULL UNIQUE,
    folder_path      TEXT NOT NULL,
    enabled          BOOLEAN NOT NULL DEFAULT 1,
    allowed_types    TEXT NOT NULL DEFAULT '.pdf,.eml,.msg',
    processed_folder TEXT,
    failed_folder    TEXT,
    recursive        BOOLEAN NOT NULL DEFAULT 0,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Default ingestion source (matches the real network path)
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
-- Assets — unique equipment records
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assets (
    serial_number       TEXT PRIMARY KEY,
    equipment_reference TEXT,
    model               TEXT,
    customer_name       TEXT,
    billing_folder      TEXT,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_assets_equipment_ref ON assets(equipment_reference);
CREATE INDEX IF NOT EXISTS idx_assets_model         ON assets(model);

-- ---------------------------------------------------------------------------
-- Work Orders — service records
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS work_orders (
    work_order_no               TEXT PRIMARY KEY,
    work_order_type             TEXT CHECK(work_order_type IN ('PM', 'W')),
    date_completed              DATE,
    technician                  TEXT,
    serial_number               TEXT,
    equipment_reference         TEXT,
    model                       TEXT,
    equipment_hours             REAL,
    total_labor_hours           REAL,
    service_request_description TEXT,
    service_performed           TEXT,
    repair_action_label         TEXT,
    problem_note_flag           BOOLEAN DEFAULT 0,
    repeat_asset_key            TEXT,
    repeat_issue_signature      TEXT,
    source_file_name            TEXT,
    source_file_hash            TEXT,
    imported_at                 TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- v2 fields
    import_status               TEXT NOT NULL DEFAULT 'processed'
                                    CHECK(import_status IN ('processed','needs_review','failed')),
    reviewed_by                 TEXT,
    reviewed_at                 TIMESTAMP,
    review_notes                TEXT,
    parser_confidence           REAL,
    duplicate_hash_warning      BOOLEAN DEFAULT 0,
    FOREIGN KEY (serial_number) REFERENCES assets(serial_number) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_wo_serial        ON work_orders(serial_number);
CREATE INDEX IF NOT EXISTS idx_wo_date          ON work_orders(date_completed);
CREATE INDEX IF NOT EXISTS idx_wo_tech          ON work_orders(technician);
CREATE INDEX IF NOT EXISTS idx_wo_type          ON work_orders(work_order_type);
CREATE INDEX IF NOT EXISTS idx_wo_file_hash     ON work_orders(source_file_hash);
CREATE INDEX IF NOT EXISTS idx_wo_import_status ON work_orders(import_status);

-- ---------------------------------------------------------------------------
-- Work Order Issues — normalized issue tags
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS work_order_issues (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    work_order_no TEXT NOT NULL,
    issue_code    TEXT NOT NULL,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (work_order_no) REFERENCES work_orders(work_order_no) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_woi_work_order ON work_order_issues(work_order_no);
CREATE INDEX IF NOT EXISTS idx_woi_issue_code ON work_order_issues(issue_code);

-- ---------------------------------------------------------------------------
-- Import Runs — batch-level tracking
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS import_runs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at     TIMESTAMP,
    files_processed  INTEGER DEFAULT 0,
    files_failed     INTEGER DEFAULT 0,
    status           TEXT DEFAULT 'running'
                         CHECK(status IN ('running','completed','failed'))
);

-- ---------------------------------------------------------------------------
-- Import Files — per-file tracking (v2: three-state status + WO link)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS import_files (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    import_run_id       INTEGER NOT NULL,
    ingestion_source_id INTEGER,
    file_name           TEXT NOT NULL,
    file_path           TEXT,
    file_hash           TEXT,
    status              TEXT DEFAULT 'pending'
                        CHECK(status IN ('pending','processing','processed','needs_review','failed','skipped')),
    work_order_no       TEXT,
    error_message       TEXT,
    processed_at        TIMESTAMP,
    FOREIGN KEY (import_run_id)       REFERENCES import_runs(id)       ON DELETE CASCADE,
    FOREIGN KEY (ingestion_source_id) REFERENCES ingestion_sources(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_if_run    ON import_files(import_run_id);
CREATE INDEX IF NOT EXISTS idx_if_hash   ON import_files(file_hash);
CREATE INDEX IF NOT EXISTS idx_if_status ON import_files(status);
CREATE INDEX IF NOT EXISTS idx_if_source ON import_files(ingestion_source_id);
CREATE INDEX IF NOT EXISTS idx_if_wo     ON import_files(work_order_no);

-- ---------------------------------------------------------------------------
-- Email Metadata — populated when source file is a .eml (v2)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_metadata (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    import_file_id      INTEGER NOT NULL UNIQUE,
    subject             TEXT,
    sender              TEXT,
    sent_date           TEXT,
    attachment_filename TEXT,
    FOREIGN KEY (import_file_id) REFERENCES import_files(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_email_import_file ON email_metadata(import_file_id);

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

-- Asset service summary (v2: adds PM/W breakdown and repeat signatures)
CREATE VIEW IF NOT EXISTS v_asset_service_summary AS
SELECT
    a.serial_number,
    a.equipment_reference,
    a.model,
    a.customer_name,
    COUNT(wo.work_order_no)                                        AS total_work_orders,
    SUM(CASE WHEN wo.work_order_type = 'PM' THEN 1 ELSE 0 END)   AS total_pm_orders,
    SUM(CASE WHEN wo.work_order_type = 'W'  THEN 1 ELSE 0 END)   AS total_w_orders,
    SUM(wo.total_labor_hours)                                      AS total_labor_hours,
    MAX(wo.date_completed)                                         AS last_service_date,
    SUM(CASE WHEN wo.problem_note_flag = 1 THEN 1 ELSE 0 END)    AS problem_count,
    GROUP_CONCAT(DISTINCT wo.repeat_issue_signature)               AS repeat_signatures
FROM assets a
LEFT JOIN work_orders wo ON a.serial_number = wo.serial_number
GROUP BY a.serial_number, a.equipment_reference, a.model, a.customer_name;

-- Issue frequency
CREATE VIEW IF NOT EXISTS v_issue_frequency AS
SELECT
    issue_code,
    COUNT(*) AS occurrence_count,
    COUNT(DISTINCT woi.work_order_no) AS work_order_count,
    COUNT(DISTINCT wo.serial_number)  AS affected_assets
FROM work_order_issues woi
JOIN work_orders wo ON woi.work_order_no = wo.work_order_no
GROUP BY issue_code
ORDER BY occurrence_count DESC;

-- Repeat problem assets
CREATE VIEW IF NOT EXISTS v_repeat_problem_assets AS
SELECT
    wo.serial_number,
    wo.equipment_reference,
    wo.model,
    COUNT(DISTINCT wo.work_order_no)  AS work_order_count,
    COUNT(DISTINCT woi.issue_code)    AS unique_issues,
    GROUP_CONCAT(DISTINCT woi.issue_code) AS issue_list,
    MAX(wo.date_completed)            AS last_service_date
FROM work_orders wo
LEFT JOIN work_order_issues woi ON wo.work_order_no = woi.work_order_no
WHERE wo.problem_note_flag = 1 OR wo.repeat_asset_key IS NOT NULL
GROUP BY wo.serial_number, wo.equipment_reference, wo.model
HAVING work_order_count > 1
ORDER BY work_order_count DESC;

-- Needs-review queue
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
