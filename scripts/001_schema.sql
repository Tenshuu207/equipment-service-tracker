-- =============================================================================
-- Crown Service Equipment Tracker — PostgreSQL Schema
-- Migration: 001_schema.sql
-- Run with: psql $DATABASE_URL -f scripts/001_schema.sql
--   or automatically on container start via docker-entrypoint-initdb.d
-- =============================================================================

-- Extension for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- ingestion_sources
-- Configured source folders / upload channels
-- =============================================================================
CREATE TABLE IF NOT EXISTS ingestion_sources (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  folder_path      TEXT,
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  allowed_types    TEXT NOT NULL DEFAULT '.pdf,.eml,.msg',
  processed_folder TEXT,
  failed_folder    TEXT,
  recursive        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- import_runs
-- One row per ingestion batch (triggered manually or by folder watcher)
-- =============================================================================
CREATE TABLE IF NOT EXISTS import_runs (
  id               SERIAL PRIMARY KEY,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,
  files_processed  INT NOT NULL DEFAULT 0,
  files_failed     INT NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed'))
);

-- =============================================================================
-- import_files
-- One row per file processed in an import run
-- =============================================================================
CREATE TABLE IF NOT EXISTS import_files (
  id                    SERIAL PRIMARY KEY,
  import_run_id         INT REFERENCES import_runs(id) ON DELETE CASCADE,
  ingestion_source_id   INT REFERENCES ingestion_sources(id) ON DELETE SET NULL,
  file_name             TEXT NOT NULL,
  file_path             TEXT,                    -- original path before archiving
  archived_path         TEXT,                    -- where the file was moved after processing
  file_hash             TEXT,                    -- SHA-256 hex string
  source_type           TEXT,                    -- .pdf | .msg | .eml
  status                TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processed', 'needs_review', 'failed')),
  work_order_no         TEXT,
  error_message         TEXT,
  processed_at          TIMESTAMPTZ,
  -- Email metadata (populated for .msg/.eml sources)
  sender                TEXT,
  subject               TEXT,
  sent_date             TIMESTAMPTZ,
  attachment_filename   TEXT,
  -- Parser metadata
  parser_confidence     NUMERIC(4,3),
  duplicate_hash_flag   BOOLEAN NOT NULL DEFAULT FALSE,
  -- Joined from ingestion_sources for convenience
  source_name           TEXT                     -- denormalised copy updated on insert
);

-- Unique file hash per source: same bytes from same source = skip, not duplicate
CREATE UNIQUE INDEX IF NOT EXISTS import_files_hash_source
  ON import_files (file_hash, ingestion_source_id)
  WHERE file_hash IS NOT NULL AND ingestion_source_id IS NOT NULL;

-- =============================================================================
-- assets
-- One row per unique serial number (upserted on each WO import)
-- =============================================================================
CREATE TABLE IF NOT EXISTS assets (
  serial_number        TEXT PRIMARY KEY,
  equipment_reference  TEXT,
  model                TEXT,
  customer_name        TEXT,
  asset_status         TEXT NOT NULL DEFAULT 'active'
    CHECK (asset_status IN ('active', 'out_of_service', 'retired')),
  internal_notes       TEXT,
  total_work_orders    INT NOT NULL DEFAULT 0,
  total_labor_hours    NUMERIC(8,2),
  last_service_date    DATE,
  problem_count        INT NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- work_orders
-- One row per parsed Crown service document
-- =============================================================================
CREATE TABLE IF NOT EXISTS work_orders (
  work_order_no                TEXT PRIMARY KEY,
  work_order_type              TEXT CHECK (work_order_type IN ('PM', 'W')),
  date_completed               DATE,
  technician                   TEXT,
  serial_number                TEXT REFERENCES assets(serial_number) ON DELETE SET NULL,
  equipment_reference          TEXT,
  model                        TEXT,
  equipment_hours              NUMERIC(10,1),
  total_labor_hours            NUMERIC(6,2),
  service_request_description  TEXT,
  service_performed            TEXT,
  repair_action_label          TEXT,
  problem_note_flag            INT NOT NULL DEFAULT 0,
  repeat_asset_key             TEXT,
  issues                       TEXT,             -- comma-separated issue codes
  source_file_name             TEXT,
  import_file_id               INT REFERENCES import_files(id) ON DELETE SET NULL,
  import_status                TEXT NOT NULL DEFAULT 'processed'
    CHECK (import_status IN ('processed', 'needs_review', 'failed')),
  parser_confidence            NUMERIC(4,3),
  reviewed_by                  TEXT,
  reviewed_at                  TIMESTAMPTZ,
  review_notes                 TEXT,
  imported_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for common filter patterns
CREATE INDEX IF NOT EXISTS work_orders_serial     ON work_orders (serial_number);
CREATE INDEX IF NOT EXISTS work_orders_date       ON work_orders (date_completed DESC);
CREATE INDEX IF NOT EXISTS work_orders_status     ON work_orders (import_status);
CREATE INDEX IF NOT EXISTS work_orders_technician ON work_orders (technician);

-- =============================================================================
-- issue_tags
-- Normalised issue codes linked to work orders (allows multi-issue queries)
-- =============================================================================
CREATE TABLE IF NOT EXISTS issue_tags (
  work_order_no  TEXT NOT NULL REFERENCES work_orders(work_order_no) ON DELETE CASCADE,
  issue_code     TEXT NOT NULL,
  PRIMARY KEY (work_order_no, issue_code)
);

CREATE INDEX IF NOT EXISTS issue_tags_code ON issue_tags (issue_code);

-- =============================================================================
-- Triggers: keep assets.updated_at and work_orders.updated_at current
-- =============================================================================
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assets_updated_at     ON assets;
DROP TRIGGER IF EXISTS work_orders_updated_at ON work_orders;

CREATE TRIGGER assets_updated_at
  BEFORE UPDATE ON assets
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER work_orders_updated_at
  BEFORE UPDATE ON work_orders
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- =============================================================================
-- Views used by the dashboard
-- =============================================================================

-- Overall dashboard stats
CREATE OR REPLACE VIEW v_dashboard_stats AS
SELECT
  (SELECT COUNT(*)            FROM assets)                                      AS total_assets,
  (SELECT COUNT(*)            FROM work_orders)                                 AS total_work_orders,
  (SELECT COUNT(*)            FROM issue_tags)                                  AS total_issues,
  (SELECT COUNT(DISTINCT serial_number)
     FROM work_orders WHERE problem_note_flag = 1)                              AS problem_assets,
  (SELECT MAX(imported_at)::TEXT FROM work_orders)                              AS last_import;

-- Issue frequency
CREATE OR REPLACE VIEW v_issue_frequency AS
SELECT issue_code, COUNT(*) AS count
FROM issue_tags
GROUP BY issue_code
ORDER BY count DESC;

-- Problem assets (repeat-issue assets)
CREATE OR REPLACE VIEW v_problem_assets AS
SELECT
  w.serial_number,
  a.equipment_reference,
  a.model,
  COUNT(DISTINCT w.work_order_no)  AS work_order_count,
  COUNT(DISTINCT t.issue_code)     AS unique_issues,
  STRING_AGG(DISTINCT t.issue_code, ',') AS issue_list,
  MAX(w.date_completed)::TEXT      AS last_service_date
FROM work_orders w
JOIN assets a          ON a.serial_number = w.serial_number
JOIN issue_tags t      ON t.work_order_no = w.work_order_no
WHERE w.problem_note_flag = 1
GROUP BY w.serial_number, a.equipment_reference, a.model
ORDER BY work_order_count DESC;
