/**
 * lib/parser-tests.ts — Self-contained parser regression tests.
 *
 * These tests run entirely in-browser. Call runParserTests() to get results.
 * Each test case is a verbatim transcript of text as it appears after
 * extractPrintableStrings() runs on the real Crown PDF — i.e. the labels and
 * values are on the same line, columns are separated by whitespace only.
 *
 * Test cases come directly from the two Crown PDFs shown in screenshots:
 *   PDF A: W132191  — Andrew Cotter,   S/N 1A403991, RM6025-45, 06/12/2025
 *   PDF B: W131962  — Thomas Carvin,   S/N 1A403990, RM6025-45, 06/05/2025
 *   PDF C: W138107  — Justin Cote,     S/N 6A293437, PE4500-60, 12/04/2025  (mock)
 *   PDF D: PM118795 — Andrew Cotter,   S/N 10183427, WP3035-45, 05/01/2025  (mock PM)
 */

import { parseServiceFile } from "./parser"

// ---------------------------------------------------------------------------
// Test fixture builder — creates a synthetic File from a text string
// ---------------------------------------------------------------------------
function makeTextFile(name: string, content: string): File {
  return new File([content], name, { type: "text/plain" })
}

// ---------------------------------------------------------------------------
// Crown PDF printable-string output as it would arrive from extractPrintableStrings()
// The text is deliberately close to what you'd get from a real PDF scan.
// ---------------------------------------------------------------------------

const PDF_A_TEXT = `
Crown Lift Trucks
165 Innovation Way Scarborough ME 04074
TEL: 207-773-4049 FAX: 207-773-5694 Branch: 721 crown.com
Dennis Food Service Customer: 132397
101 Mecaw Rd Hampden ME 04444 TEL: 207-947-0321
Work Order No.: W132191 Seg: 1
Date Started: 06/12/2025
Date Completed: 06/12/2025
Purchase Order:
Technician: Andrew Cotter
Van: V-019
Billing Folder: Work From a PM
Make: CRW Model: RM6025-45 S/N: 1A403991 Cust ID: #30 Hours: 20365.
Service Request Description Screw for door behind operator
Repair Action Code Installed and Adjusted Door
Service Performed Old screw what stripped out. Had to cut off with the cutoff wheel. Dug screw out and replaced with new one. Returned to service.
Part Number Description Quantity
060015-108 SCREW .250 1.0
Total Labor Hours: 0.50
`.trim()

const PDF_B_TEXT = `
Crown Lift Trucks
165 Innovation Way Scarborough ME 04074
TEL: 207-773-4049 FAX: 207-773-5694 Branch: 721 crown.com
Dennis Food Service Customer: 132397
101 Mecaw Rd Hampden ME 04444 TEL: 207-947-0321
Work Order No.: W131962 Seg: 1
Date Started: 06/05/2025
Date Completed: 06/05/2025
Purchase Order:
Technician: Thomas Carvin
Van: V-029
Billing Folder: Cust Pay
Make: CRW Model: RM6025-45 S/N: 1A403990 Cust ID: Hours: 15048.
Service Request Description Intermittently throws service light
Repair Action Code Troubleshoot-Diagnose Battery
Service Performed Codes 867 and 222 are in history, tested battery voltage, battery dropped to 17V under load, possible bad cells, battery 9years old manufactured 2016.
Total Labor Hours: 0.50
`.trim()

const PDF_C_TEXT = `
Crown Lift Trucks
165 Innovation Way Scarborough ME 04074
Dennis Food Service Customer: 132397
Work Order No.: W138107 Seg: 1
Date Completed: 12/04/2025
Technician: Justin Cote
Van: V-022
Make: CRW Model: PE4500-60 S/N: 6A293437 Cust ID: #42 Hours: 10431.
Service Request Description Pallet jack throttle issues - sometimes no power, inconsistent throttle control
Repair Action Code Repaired Control Handle
Service Performed Found lift truck, verified customers complaint. The last 10 event codes are 336 THROTTLE VOLTAGE OUTSIDE LIMITS. Found nut that holds POT1 loose, tightened and re adjusted throttle, Forward Switch, and Reverse Switch.
Total Labor Hours: 4.00
`.trim()

const PDF_D_TEXT = `
Crown Lift Trucks
Dennis Food Service Customer: 132397
Work Order No.: PM118795 Seg: 1
Date Completed: 05/01/2025
Technician: Andrew Cotter
Make: CRW Model: WP3035-45 S/N: 10183427 Hours: 2193.
Service Request Description Planned Maintenance
Repair Action Code Planned Maintenance for Electric Unit
Service Performed Found truck and brought to work area. Removed all covers and blew the truck off. Greased all fittings and checked all adjustment points. Test drove and wiped down. Returned to service.
Total Labor Hours: 0.93
`.trim()

// ---------------------------------------------------------------------------
// Assertion helper
// ---------------------------------------------------------------------------
type TestResult = {
  name: string
  passed: boolean
  failures: string[]
  parsed: Record<string, unknown>
}

function check(result: TestResult, field: string, expected: unknown, actual: unknown) {
  if (String(actual) !== String(expected)) {
    result.failures.push(`${field}: expected "${expected}", got "${actual}"`)
    result.passed = false
  }
}

function checkContains(result: TestResult, field: string, substring: string, actual: string | null) {
  if (!actual?.toLowerCase().includes(substring.toLowerCase())) {
    result.failures.push(`${field}: expected to contain "${substring}", got "${actual}"`)
    result.passed = false
  }
}

function checkNotNull(result: TestResult, field: string, actual: unknown) {
  if (actual === null || actual === undefined || actual === "") {
    result.failures.push(`${field}: expected non-null, got null/empty`)
    result.passed = false
  }
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

async function testPdfA(): Promise<TestResult> {
  const result: TestResult = { name: "PDF-A: W132191 (Andrew Cotter, RM6025-45, door screw)", passed: true, failures: [], parsed: {} }
  const file = makeTextFile("W132191.pdf", PDF_A_TEXT)
  const p = await parseServiceFile(file)
  result.parsed = p.workOrder as unknown as Record<string, unknown>

  check(result, "work_order_no",              "W132191",       p.workOrder.work_order_no)
  check(result, "work_order_type",             "W",             p.workOrder.work_order_type)
  check(result, "serial_number",              "1A403991",      p.workOrder.serial_number)
  check(result, "model",                      "RM6025-45",     p.workOrder.model)
  check(result, "technician",                 "Andrew Cotter", p.workOrder.technician)
  check(result, "date_completed",             "2025-06-12",    p.workOrder.date_completed)
  check(result, "equipment_hours",            "20365",         String(p.workOrder.equipment_hours))
  check(result, "total_labor_hours",          "0.5",           String(p.workOrder.total_labor_hours))
  checkContains(result, "service_request_description", "door", p.workOrder.service_request_description)
  checkContains(result, "repair_action_label",          "Door", p.workOrder.repair_action_label)
  checkContains(result, "service_performed",            "stripped out", p.workOrder.service_performed)
  checkNotNull(result, "equipment_reference",           p.workOrder.equipment_reference)

  return result
}

async function testPdfB(): Promise<TestResult> {
  const result: TestResult = { name: "PDF-B: W131962 (Thomas Carvin, RM6025-45, battery)", passed: true, failures: [], parsed: {} }
  const file = makeTextFile("W131962.pdf", PDF_B_TEXT)
  const p = await parseServiceFile(file)
  result.parsed = p.workOrder as unknown as Record<string, unknown>

  check(result, "work_order_no",              "W131962",       p.workOrder.work_order_no)
  check(result, "serial_number",              "1A403990",      p.workOrder.serial_number)
  check(result, "model",                      "RM6025-45",     p.workOrder.model)
  check(result, "technician",                 "Thomas Carvin", p.workOrder.technician)
  check(result, "date_completed",             "2025-06-05",    p.workOrder.date_completed)
  check(result, "equipment_hours",            "15048",         String(p.workOrder.equipment_hours))
  check(result, "total_labor_hours",          "0.5",           String(p.workOrder.total_labor_hours))
  checkContains(result, "service_request_description", "service light", p.workOrder.service_request_description)
  checkContains(result, "repair_action_label",          "Battery",       p.workOrder.repair_action_label)
  checkContains(result, "service_performed",            "battery voltage", p.workOrder.service_performed)
  // Battery issue should be detected
  if (!p.workOrder.issues?.includes("battery_electrical")) {
    result.failures.push(`issues: expected "battery_electrical" in "${p.workOrder.issues}"`)
    result.passed = false
  }

  return result
}

async function testPdfC(): Promise<TestResult> {
  const result: TestResult = { name: "PDF-C: W138107 (Justin Cote, PE4500-60, throttle)", passed: true, failures: [], parsed: {} }
  const file = makeTextFile("W138107.pdf", PDF_C_TEXT)
  const p = await parseServiceFile(file)
  result.parsed = p.workOrder as unknown as Record<string, unknown>

  check(result, "work_order_no",   "W138107",    p.workOrder.work_order_no)
  check(result, "serial_number",   "6A293437",   p.workOrder.serial_number)
  check(result, "model",           "PE4500-60",  p.workOrder.model)
  check(result, "technician",      "Justin Cote",p.workOrder.technician)
  check(result, "date_completed",  "2025-12-04", p.workOrder.date_completed)
  check(result, "total_labor_hours","4",         String(p.workOrder.total_labor_hours))
  if (!p.workOrder.issues?.includes("throttle_controls")) {
    result.failures.push(`issues: expected "throttle_controls" in "${p.workOrder.issues}"`)
    result.passed = false
  }

  return result
}

async function testPdfD(): Promise<TestResult> {
  const result: TestResult = { name: "PDF-D: PM118795 (Andrew Cotter, WP3035-45, planned maintenance)", passed: true, failures: [], parsed: {} }
  const file = makeTextFile("PM118795.pdf", PDF_D_TEXT)
  const p = await parseServiceFile(file)
  result.parsed = p.workOrder as unknown as Record<string, unknown>

  check(result, "work_order_no",    "PM118795",    p.workOrder.work_order_no)
  check(result, "work_order_type",  "PM",          p.workOrder.work_order_type)
  check(result, "serial_number",    "10183427",    p.workOrder.serial_number)
  check(result, "model",            "WP3035-45",   p.workOrder.model)
  check(result, "technician",       "Andrew Cotter", p.workOrder.technician)
  check(result, "date_completed",   "2025-05-01",  p.workOrder.date_completed)
  check(result, "total_labor_hours","0.93",        String(p.workOrder.total_labor_hours))
  if (!p.workOrder.issues?.includes("planned_maintenance")) {
    result.failures.push(`issues: expected "planned_maintenance" in "${p.workOrder.issues}"`)
    result.passed = false
  }

  return result
}

async function testMsgFilename(): Promise<TestResult> {
  // When PDF extraction yields nothing, WO should still come from filename
  const result: TestResult = { name: "MSG-filename fallback: WO from filename when body is empty", passed: true, failures: [], parsed: {} }
  // Simulate a .msg that contains no readable text (empty body)
  const file = new File([new Uint8Array(512).fill(0)], "Completed Service Confirmation W132191.msg", { type: "application/octet-stream" })
  const p = await parseServiceFile(file)
  result.parsed = p.workOrder as unknown as Record<string, unknown>

  check(result, "work_order_no", "W132191", p.workOrder.work_order_no)
  // confidence should be low (< 0.65) since only WO was found
  if (p.confidence >= 0.65) {
    result.failures.push(`confidence: expected < 0.65 for filename-only parse, got ${p.confidence}`)
    result.passed = false
  }

  return result
}

async function testDuplicateWOFilename(): Promise<TestResult> {
  // Two files with the same WO number should parse to the same work_order_no
  const result: TestResult = { name: "Idempotency: same WO from different filename formats", passed: true, failures: [], parsed: {} }
  const f1 = makeTextFile("W131962.pdf", PDF_B_TEXT)
  const f2 = makeTextFile("Completed Service Confirmation W131962.msg", PDF_B_TEXT)
  const [p1, p2] = await Promise.all([parseServiceFile(f1), parseServiceFile(f2)])
  result.parsed = { f1: p1.workOrder.work_order_no, f2: p2.workOrder.work_order_no }

  if (p1.workOrder.work_order_no !== p2.workOrder.work_order_no) {
    result.failures.push(`WO mismatch: "${p1.workOrder.work_order_no}" vs "${p2.workOrder.work_order_no}"`)
    result.passed = false
  }

  return result
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
export interface ParserTestSummary {
  total: number
  passed: number
  failed: number
  results: TestResult[]
  timestamp: string
}

export async function runParserTests(): Promise<ParserTestSummary> {
  const tests = [testPdfA, testPdfB, testPdfC, testPdfD, testMsgFilename, testDuplicateWOFilename]
  const results = await Promise.all(tests.map(t => t()))
  const passed = results.filter(r => r.passed).length
  return {
    total:  results.length,
    passed,
    failed: results.length - passed,
    results,
    timestamp: new Date().toISOString(),
  }
}
