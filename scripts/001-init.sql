-- =============================================================================
-- Crown Service Equipment Tracker — PostgreSQL Schema
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id            SERIAL PRIMARY KEY,
  name          TEXT    NOT NULL UNIQUE,
  customer_no   TEXT,
  address       TEXT,
  city          TEXT,
  state         TEXT,
  zip           TEXT,
  phone         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Assets (one row per physical lift truck)
-- ---------------------------------------------------------------------------
CREATE TYPE asset_status AS ENUM ('active', 'out_of_service', 'retired');

CREATE TABLE IF NOT EXISTS assets (
  serial_number       TEXT        PRIMARY KEY,
  equipment_reference TEXT,
  model               TEXT,
  make                TEXT        DEFAULT 'CRW',
  customer_id         INT         REFERENCES customers(id) ON DELETE SET NULL,
  status              asset_status NOT NULL DEFAULT 'active',
  internal_notes      TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assets_customer_idx ON assets(customer_id);
CREATE INDEX IF NOT EXISTS assets_model_idx    ON assets(model);

-- ---------------------------------------------------------------------------
-- Work Orders
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS work_orders (
  work_order_no               TEXT        PRIMARY KEY,
  work_order_type             TEXT        CHECK (work_order_type IN ('PM','W','EM')),
  date_started                DATE,
  date_completed              DATE,
  technician                  TEXT,
  van                         TEXT,
  serial_number               TEXT        REFERENCES assets(serial_number) ON DELETE SET NULL,
  equipment_reference         TEXT,
  model                       TEXT,
  make                        TEXT,
  customer_id                 INT         REFERENCES customers(id) ON DELETE SET NULL,
  customer_ref                TEXT,
  equipment_hours             NUMERIC(10,1),
  total_labor_hours           NUMERIC(6,2),
  billing_folder              TEXT,
  service_request_description TEXT,
  repair_action_label         TEXT,
  service_performed           TEXT,
  problem_note_flag           SMALLINT    NOT NULL DEFAULT 0,
  repeat_asset_key            TEXT,
  issues                      TEXT,                          -- comma-separated issue codes
  import_status               TEXT        NOT NULL DEFAULT 'processed'
                                          CHECK (import_status IN ('processed','needs_review','failed')),
  parser_confidence           NUMERIC(4,3),
  reviewed_by                 TEXT,
  reviewed_at                 TIMESTAMPTZ,
  review_notes                TEXT,
  duplicate_hash_warning      SMALLINT    NOT NULL DEFAULT 0,
  source_file_name            TEXT,
  imported_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wo_serial_idx      ON work_orders(serial_number);
CREATE INDEX IF NOT EXISTS wo_date_idx        ON work_orders(date_completed);
CREATE INDEX IF NOT EXISTS wo_technician_idx  ON work_orders(technician);
CREATE INDEX IF NOT EXISTS wo_status_idx      ON work_orders(import_status);

-- ---------------------------------------------------------------------------
-- Ingestion Sources (watched folder definitions)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingestion_sources (
  id                SERIAL PRIMARY KEY,
  name              TEXT    NOT NULL,
  folder_path       TEXT    NOT NULL,
  enabled           BOOLEAN NOT NULL DEFAULT true,
  allowed_types     TEXT    NOT NULL DEFAULT '.pdf,.eml,.msg',
  processed_folder  TEXT,
  failed_folder     TEXT,
  recursive         BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Import Runs (one per batch / folder scan / manual upload)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS import_runs (
  id               SERIAL PRIMARY KEY,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ,
  files_processed  INT NOT NULL DEFAULT 0,
  files_failed     INT NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'running'
                   CHECK (status IN ('running','completed','failed'))
);

-- ---------------------------------------------------------------------------
-- Import Files (one row per file processed)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS import_files (
  id                   SERIAL PRIMARY KEY,
  import_run_id        INT         REFERENCES import_runs(id)          ON DELETE SET NULL,
  ingestion_source_id  INT         REFERENCES ingestion_sources(id)    ON DELETE SET NULL,
  file_name            TEXT        NOT NULL,
  file_path            TEXT,
  archived_path        TEXT,
  file_hash            TEXT,                                            -- SHA-256 hex
  source_type          TEXT,                                            -- .pdf / .msg / .eml
  status               TEXT        NOT NULL DEFAULT 'processed'
                                   CHECK (status IN ('processed','needs_review','failed')),
  work_order_no        TEXT        REFERENCES work_orders(work_order_no) ON DELETE SET NULL,
  error_message        TEXT,
  sender               TEXT,
  subject              TEXT,
  attachment_filename  TEXT,
  sent_date            TIMESTAMPTZ,
  duplicate_hash_flag  BOOLEAN     NOT NULL DEFAULT false,
  parser_confidence    NUMERIC(4,3),
  processed_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prevent re-ingesting the exact same file bytes
CREATE UNIQUE INDEX IF NOT EXISTS import_files_hash_unique
  ON import_files(file_hash)
  WHERE file_hash IS NOT NULL AND file_hash != 'seeded';

CREATE INDEX IF NOT EXISTS import_files_run_idx    ON import_files(import_run_id);
CREATE INDEX IF NOT EXISTS import_files_status_idx ON import_files(status);
CREATE INDEX IF NOT EXISTS import_files_wo_idx     ON import_files(work_order_no);

-- ---------------------------------------------------------------------------
-- Asset issue summary (materialised by the app on each import)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS asset_issue_counts (
  serial_number  TEXT NOT NULL REFERENCES assets(serial_number) ON DELETE CASCADE,
  issue_code     TEXT NOT NULL,
  count          INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (serial_number, issue_code)
);

-- ---------------------------------------------------------------------------
-- Trigger: keep assets.updated_at current
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assets_updated_at ON assets;
CREATE TRIGGER assets_updated_at
  BEFORE UPDATE ON assets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS ingestion_sources_updated_at ON ingestion_sources;
CREATE TRIGGER ingestion_sources_updated_at
  BEFORE UPDATE ON ingestion_sources
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
