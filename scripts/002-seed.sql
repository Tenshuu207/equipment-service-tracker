-- =============================================================================
-- Crown Service Equipment Tracker — Seed Data
-- Demo records (anonymized) for local development.
-- Safe to re-run: uses ON CONFLICT DO NOTHING / DO UPDATE.
-- =============================================================================

-- Customer
INSERT INTO customers (name, customer_no, city, state)
VALUES ('Sample Warehouse Co', '000001', 'Sampletown', 'ME')
ON CONFLICT (name) DO NOTHING;

-- Assets
INSERT INTO assets (serial_number, equipment_reference, model, make, customer_id, status)
SELECT s, ref, mdl, 'CRW', c.id, 'active'
FROM (VALUES
  ('6A293437', '#42', 'PE4500-60'),
  ('1A460250', '#8',  'SP3520-30'),
  ('6A286154', '#27', 'PE4500-60'),
  ('1A384086', '#6',  'SP3510-30'),
  ('6A276850', NULL,  'PE4500-80'),
  ('10183427', NULL,  'WP3035-45'),
  ('1A403990', NULL,  'RM6025-45')
) AS v(s, ref, mdl)
JOIN customers c ON c.name = 'Sample Warehouse Co'
ON CONFLICT (serial_number) DO NOTHING;

-- Ingestion source
INSERT INTO ingestion_sources (name, folder_path, enabled, allowed_types, processed_folder, failed_folder, recursive)
VALUES (
  'Crown Incoming',
  '/imports/incoming',
  true,
  '.pdf,.eml,.msg',
  '/imports/processed',
  '/imports/failed',
  false
)
ON CONFLICT DO NOTHING;

-- Import run (seed batch)
INSERT INTO import_runs (id, started_at, completed_at, files_processed, files_failed, status)
VALUES (1, '2025-12-17 08:14:51+00', '2025-12-17 08:15:04+00', 5, 0, 'completed')
ON CONFLICT DO NOTHING;

-- Work orders
INSERT INTO work_orders (
  work_order_no, work_order_type, date_completed, technician,
  serial_number, equipment_reference, model,
  equipment_hours, total_labor_hours,
  service_request_description, repair_action_label, service_performed,
  problem_note_flag, issues, import_status, parser_confidence, source_file_name, imported_at
) VALUES
(
  'W138240', 'W', '2025-12-05', 'Tech A',
  '6A286154', '#27', 'PE4500-60',
  5394, 3.0,
  'Prep lift truck for scrap',
  'Inspected Load Backrest',
  'Customer requested prep for scrapping. Transferred load back rest, removed commonly used parts and access modules. Removed battery, load back rest, access modules.',
  0, 'battery_electrical,decommission,load_backrest', 'processed', 0.95, 'W138240.pdf', '2025-12-17 08:15:00+00'
),
(
  'W138107', 'W', '2025-12-04', 'Tech A',
  '6A293437', '#42', 'PE4500-60',
  10431, 4.0,
  'Pallet jack #42 — operator complained of throttle issues, sometimes no power, inconsistent throttle control',
  'Repaired Control Handle',
  'Found lift truck, verified complaint. Last 10 event codes are 336 THROTTLE VOLTAGE OUTSIDE LIMITS. Found nut that holds POT1 loose. Tightened nut, re-adjusted throttle, Forward Switch, and Reverse Switch. Ordered and replaced spring and bushings. Re-calibrated POT1, performed function test, returned to service.',
  1, 'throttle_controls', 'processed', 0.92, 'W138107.pdf', '2025-12-17 08:15:02+00'
),
(
  'W137822', 'W', '2025-12-17', 'Tech A',
  '1A460250', '#8', 'SP3520-30',
  18457, NULL,
  'Remove and replace platform mat',
  'Removed, Tested and Replaced Floor Board/Pad',
  'Found and brought lift truck outside. Removed damaged floor pad. Scraped and ground away old adhesive and rust spots. Cleaned and prepped surface. Installed new floor pad with weight on top. Truck tagged out for 24 hours to cure adhesive.',
  1, 'floor_platform', 'processed', 0.88, 'W137822.pdf', '2025-12-17 08:15:04+00'
),
(
  'W135041', 'W', '2025-09-04', 'Tech B',
  '1A384086', '#6', 'SP3510-30',
  6895, 1.0,
  'Aisle guide wheels and load wheels',
  'Installed Load Wheels',
  'Found truck and brought to work area. Jacked and blocked outriggers. Removed front load wheels and left side aisle guide wheel. Installed new right rear aisle guide wheel, repaired spring one side. Greased all fittings and test drove. Returned to service.',
  0, 'guide_wheel,load_wheel', 'processed', 0.91, 'W135041.pdf', '2025-09-10 07:30:00+00'
),
(
  'PM118795', 'PM', '2025-05-01', 'Tech B',
  '10183427', NULL, 'WP3035-45',
  2193, 0.93,
  NULL,
  'Planned Maintenance for Electric Unit',
  'Found truck and brought to work area. Removed all covers and blew the truck off. Greased all fittings and checked all adjustment points. Test drove and wiped down. Returned to service.',
  0, 'planned_maintenance', 'processed', 0.90, 'PM118795.pdf', '2025-05-02 06:00:00+00'
),
(
  'PM118779', 'PM', '2025-05-01', 'Tech B',
  '6A276850', NULL, 'PE4500-80',
  6845, 1.05,
  NULL,
  'Planned Maintenance for Electric Unit',
  'Found truck and brought to work area. Removed doors and blew the truck off. Greased all fittings and checked all adjustment points. Test drove and wiped down. Returned to service.',
  0, 'planned_maintenance', 'processed', 0.90, 'PM118779.pdf', '2025-05-02 06:00:00+00'
)
ON CONFLICT (work_order_no) DO NOTHING;

-- Import file records
INSERT INTO import_files (id, import_run_id, ingestion_source_id, file_name, file_path, archived_path, file_hash, source_type, status, work_order_no, parser_confidence, processed_at)
VALUES
  (1, 1, 1, 'W138240.pdf',  '/imports/processed/W138240.pdf',  '/imports/processed/W138240.pdf',  'seeded', '.pdf', 'processed', 'W138240',  0.95, '2025-12-17 08:15:00+00'),
  (2, 1, 1, 'W138107.eml',  '/imports/processed/W138107.eml',  '/imports/processed/W138107.eml',  'seeded', '.eml', 'processed', 'W138107',  0.92, '2025-12-17 08:15:02+00'),
  (3, 1, 1, 'W137822.pdf',  '/imports/processed/W137822.pdf',  '/imports/processed/W137822.pdf',  'seeded', '.pdf', 'processed', 'W137822',  0.88, '2025-12-17 08:15:04+00'),
  (4, 1, 1, 'W135041.pdf',  '/imports/processed/W135041.pdf',  '/imports/processed/W135041.pdf',  'seeded', '.pdf', 'processed', 'W135041',  0.91, '2025-09-10 07:30:00+00'),
  (5, 1, 1, 'PM118795.pdf', '/imports/processed/PM118795.pdf', '/imports/processed/PM118795.pdf', 'seeded', '.pdf', 'processed', 'PM118795', 0.90, '2025-05-02 06:00:00+00')
ON CONFLICT DO NOTHING;

-- Asset issue counts (derived from work orders above)
INSERT INTO asset_issue_counts (serial_number, issue_code, count)
VALUES
  ('6A286154', 'battery_electrical', 1),
  ('6A286154', 'decommission',       1),
  ('6A286154', 'load_backrest',      1),
  ('6A293437', 'throttle_controls',  1),
  ('1A460250', 'floor_platform',     1),
  ('1A384086', 'guide_wheel',        1),
  ('1A384086', 'load_wheel',         1),
  ('10183427', 'planned_maintenance',1),
  ('6A276850', 'planned_maintenance',1)
ON CONFLICT (serial_number, issue_code) DO UPDATE SET count = asset_issue_counts.count + 0;
-- ^ DO UPDATE with no-op prevents error on re-seed; real counts are managed by the app.
