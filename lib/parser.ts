/**
 * lib/parser.ts — Client-side Crown service confirmation file parser.
 *
 * The real Crown PDF format (from photo evidence) looks like:
 *
 *   Work Order No.: W132191          Seg: 1
 *   Date Started:   06/12/2025
 *   Date Completed: 06/12/2025
 *   Technician:     Andrew Cotter
 *   Van:            V-019
 *   Make: CRW  Model: RM6025-45   S/N: 1A403991   Cust ID: #30   Hours: 20365.
 *   Service Request Description    Screw for door behind operator
 *   Repair Action Code             Installed and Adjusted Door
 *   Service Performed              Old screw what stripped out...
 *   Part Number    Description                    Quantity
 *   060015-108     SCREW .250                     1.0
 *   Total Labor Hours: 0.50
 *
 * Strategy for .msg files:
 *   Scan the raw binary for PDF magic bytes (%PDF), extract the slice to %%EOF,
 *   then run printable-string extraction on those PDF bytes.
 *   Also scan the whole .msg for UTF-16LE strings (email body/subject).
 */

import type { WorkOrder } from "@/lib/api"

export interface ParseResult {
  workOrder: WorkOrder
  confidence: number
  extractedFields: string[]
  warnings: string[]
  debugText?: string   // first 1500 chars of extracted text — shown in upload panel
}

// ---------------------------------------------------------------------------
// Issue keyword map — tuned to Crown service language
// ---------------------------------------------------------------------------
const ISSUE_KEYWORDS: Record<string, string[]> = {
  load_wheel:          ["load wheel", "loadwheel", "load-wheel", "poly load", "front load wheel"],
  guide_wheel:         ["guide wheel", "aisle guide", "asile guide", "guidewhl", "guide whl"],
  drive_wheel:         ["drive wheel", "drivewhl", "drive whl"],
  caster_wheel:        ["caster", "caster wheel"],
  throttle_controls:   ["throttle", "pot1", "control handle", "twist grip", "forward switch", "reverse switch", "joystick", "event code 336", "throttle voltage"],
  battery_electrical:  ["battery", "charger", "thermal resistor", "soldered", "wire", "battery lifting", "cell", "electrical"],
  floor_platform:      ["floor pad", "platform mat", "floor mat", "floor board", "adhesive", "scraped", "grinded", "platform"],
  load_backrest:       ["load back rest", "load backrest", "backrest", "lbr"],
  planned_maintenance: ["planned maintenance", "pm inspection", "greased all fittings", "blew the truck", "wiped down", "blew out", "pm service"],
  decommission:        ["scrap", "scrapping", "decommission", "remove access modules", "prep lift truck for scrap"],
  brakes:              ["brake", "braking"],
  hydraulics:          ["hydraulic", "lift cylinder", "tilt cylinder", "mast fluid"],
  mast:                ["mast", "chain", "lift chain", "chain lube"],
  forks:               ["fork", "tine"],
  steering:            ["steering", "steer wheel"],
  lights:              ["light", "headlight", "warning light"],
  horn:                ["horn"],
  seat:                ["seat", "operator seat"],
  overhead_guard:      ["overhead guard", "ohg"],
  door:                ["door", "screw for door", "door panel"],
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function normalize(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = re.exec(text)
    if (m) return (m[1] ?? m[0])?.trim() ?? null
  }
  return null
}

function detectIssues(text: string): string[] {
  const lower = text.toLowerCase()
  const found: string[] = []
  for (const [code, keywords] of Object.entries(ISSUE_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) found.push(code)
  }
  return found
}

// ---------------------------------------------------------------------------
// Binary text extractors
// ---------------------------------------------------------------------------
function extractPrintableStrings(bytes: Uint8Array, minLen = 4): string {
  let out = ""
  let run = ""
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i]
    if (c >= 32 && c < 127) {
      run += String.fromCharCode(c)
    } else {
      if (run.length >= minLen) out += run + "\n"
      run = ""
    }
  }
  if (run.length >= minLen) out += run
  return out
}

function extractUtf16Strings(bytes: Uint8Array, minLen = 6): string {
  const strings: string[] = []
  let i = 0
  while (i < bytes.length - 1) {
    if (bytes[i + 1] === 0 && bytes[i] >= 32 && bytes[i] < 127) {
      let s = ""
      while (i < bytes.length - 1 && bytes[i + 1] === 0 && bytes[i] >= 32 && bytes[i] < 127) {
        s += String.fromCharCode(bytes[i])
        i += 2
      }
      if (s.length >= minLen) strings.push(s)
    } else {
      i++
    }
  }
  return strings.join("\n")
}

/**
 * Filter printable-string lines to keep only those that look like real human text.
 * Removes lines that are mostly hex, binary tokens, PDF operators, or short fragments.
 */
function filterToReadableLines(raw: string): string {
  return raw
    .split("\n")
    .filter(line => {
      const t = line.trim()
      if (t.length < 4) return false
      // Count alphabetic characters
      const alphaCount = (t.match(/[a-zA-Z]/g) || []).length
      const ratio = alphaCount / t.length
      // Lowered threshold from 30% to 20% — Crown PDFs have lots of numeric data (hours, dates, part numbers)
      // Keep lines where at least 20% of chars are letters, OR the line is a label ending with colon
      return ratio >= 0.20 || /^[A-Z][A-Za-z\s]{2,20}:/.test(t)
    })
    .join("\n")
}

/** Find and extract all PDF segments embedded anywhere in a binary blob. */
function extractEmbeddedPdfs(bytes: Uint8Array): string {
  const results: string[] = []
  for (let i = 0; i < bytes.length - 4; i++) {
    if (bytes[i] === 0x25 && bytes[i+1] === 0x50 && bytes[i+2] === 0x44 && bytes[i+3] === 0x46) {
      const end = Math.min(i + 20_000_000, bytes.length)
      let eofPos = end
      for (let j = end - 5; j > i; j--) {
        if (
          bytes[j]   === 0x25 && bytes[j+1] === 0x25 &&
          bytes[j+2] === 0x45 && bytes[j+3] === 0x4F && bytes[j+4] === 0x46
        ) {
          eofPos = j + 5
          break
        }
      }
      const pdfSlice = bytes.slice(i, eofPos)
      const raw  = extractPrintableStrings(pdfSlice, 4)
      const text = filterToReadableLines(raw)
      if (text.trim().length > 50) results.push(text)
      i = eofPos
    }
  }
  return results.join("\n\n")
}

// ---------------------------------------------------------------------------
// File text extractor
// ---------------------------------------------------------------------------

/**
 * Try the server-side /api/parse route first.
 * It runs pdf-parse (real PDF library) which handles font encoding properly.
 * Falls back to browser-side extraction if the route fails or is unavailable.
 */
async function extractTextViaServer(file: File): Promise<{ text: string; warning?: string } | null> {
  try {
    const form = new FormData()
    form.append("file", file)
    const res = await fetch("/api/parse", { method: "POST", body: form })
    if (!res.ok) return null
    const json = await res.json()
    if (json.error) return null
    return { text: json.text ?? "", warning: json.warning }
  } catch {
    return null
  }
}

/** Browser-side fallback — less reliable but works offline. */
async function extractTextBrowser(file: File): Promise<string> {
  const ext = file.name.toLowerCase().split(".").pop() ?? ""

  if (ext === "msg") {
    const buf   = await file.arrayBuffer()
    const bytes = new Uint8Array(buf)
    const parts: string[] = []

    const pdfText = extractEmbeddedPdfs(bytes)
    if (pdfText.trim().length > 30) parts.push(pdfText)

    const utf16 = filterToReadableLines(extractUtf16Strings(bytes, 8))
    if (utf16.trim().length > 20) parts.push(utf16)

    if (parts.length === 0) {
      const fallback = filterToReadableLines(extractPrintableStrings(bytes, 6))
      parts.push(fallback)
    }

    return parts.join("\n\n")
  }

  if (ext === "eml") {
    const text  = await file.text()
    const buf   = await file.arrayBuffer()
    const bytes = new Uint8Array(buf)
    const pdfText = extractEmbeddedPdfs(bytes)
    return pdfText.trim().length > 30 ? pdfText + "\n\n" + text : text
  }

  if (ext === "pdf") {
    const buf = await file.arrayBuffer()
    return extractPrintableStrings(new Uint8Array(buf), 4)
  }

  try { return await file.text() } catch { return "" }
}

async function extractText(file: File): Promise<{ text: string; serverExtracted: boolean; warning?: string }> {
  const server = await extractTextViaServer(file)
  if (server && server.text.length > 50) {
    return { text: server.text, serverExtracted: true, warning: server.warning }
  }
  // Server route unavailable or returned nothing useful — fall back to browser
  const text = await extractTextBrowser(file)
  return { text, serverExtracted: false, warning: "Server extraction unavailable — using browser fallback (reduced accuracy)" }
}

// ---------------------------------------------------------------------------
// Main parse function
// ---------------------------------------------------------------------------
export async function parseServiceFile(file: File): Promise<ParseResult> {
  const { text: raw, serverExtracted, warning: extractWarning } = await extractText(file)
  const text = normalize(raw)
  const warnings: string[] = []
  if (extractWarning) warnings.push(extractWarning)
  if (!serverExtracted) warnings.push("Browser-side extraction used — field accuracy may be lower")
  const found: string[] = []
  const now  = new Date().toISOString()

  // ── Work Order Number ──────────────────────────────────────────────────────
  // Crown formats: W132191, PM118795, W138107
  // In the PDF the label is "Work Order No.:" followed by the number
  let work_order_no = firstMatch(text, [
    /Work\s+Order\s+No\.?\s*:?\s*([A-Z]{1,2}\d{5,8})/i,
    /Work\s+Order\s*#?\s*:?\s*([A-Z]{1,2}\d{5,8})/i,
    /W\.?O\.?\s*(?:No\.?|#)?\s*:?\s*([A-Z]{1,2}\d{5,8})/i,
    /\b(PM\d{5,8})\b/,
    /\b(W\d{5,8})\b/,
  ])
  if (work_order_no) {
    work_order_no = work_order_no.replace(/\s+/g, "").toUpperCase()
    // WO → W prefix normalisation
    if (work_order_no.startsWith("WO")) work_order_no = "W" + work_order_no.slice(2)
  }
  // Fallback: try filename  e.g. "Completed Service Confirmation W132191.msg"
  if (!work_order_no) {
    const m = /\b([A-Z]{1,2}\d{5,8})\b/i.exec(file.name.replace(/\.[^.]+$/, ""))
    if (m) work_order_no = m[1].toUpperCase()
  }
  if (!work_order_no) {
    work_order_no = `DEMO${Date.now().toString().slice(-6)}`
    warnings.push("Work order number not found — assigned synthetic ID")
  } else {
    found.push("work_order_no")
  }

  const work_order_type: "PM" | "W" | null =
    work_order_no.startsWith("PM") || /planned\s+maintenance/i.test(text) ? "PM" : "W"

  // ── Serial Number ──────────────────────────────────────────────────────────
  // Crown format from photo: "S/N: 1A403991" on the make/model line
  // Also seen: 6A293437, 1A460250, 10183427, 6A276850
  const serial_number = firstMatch(text, [
    /S\/N\s*:?\s*([A-Z0-9]{6,12})\b/i,
    /Serial\s*(?:Number|No\.?|#)?\s*:?\s*([A-Z0-9]{6,12})\b/i,
    /Unit\s+Serial\s*:?\s*([A-Z0-9]{6,12})\b/i,
    // Crown pattern: 1 digit + 1 letter + 6 digits  e.g. 1A403991, 6A293437
    /\b([1-9][A-Z]\d{6})\b/,
    // Pure numeric 7-9 digits e.g. 10183427 — must NOT be followed by decimals (hours) or preceded by WO-like patterns
    /(?<![A-Z])(?<!W)(?<!PM)\b(\d{7,9})\b(?!\s*(?:hrs?|hours?|\.?\d))/,
  ])
  if (serial_number) found.push("serial_number")
  else warnings.push("Serial number not found")

  // ── Model ──────────────────────────────────────────────────────────────────
  // From photo: "Model: RM6025-45" — also PE4500-60, SP3520-30, WP3035-45
  const model = firstMatch(text, [
    /Model\s*:?\s*([A-Z]{2,4}\d{3,4}[A-Z0-9\-]{0,8})/i,
    /\b(PE\d{4}[A-Z]?-\d{2,3})\b/i,
    /\b(SP\d{4}[A-Z]?-\d{2,3})\b/i,
    /\b(WP\d{4}[A-Z]?-\d{2,3})\b/i,
    /\b(RM\d{4}[A-Z]?-\d{2,3})\b/i,
    /\b(RR\d{4}[A-Z]?-\d{2,3})\b/i,
    /\b(FC\d{4}[A-Z]?-\d{2,3})\b/i,
    /\b(ESR\d{3,4}[A-Z0-9\-]{0,6})\b/i,
  ])
  if (model) found.push("model")

  // ── Equipment Reference / Unit # ──────────────────────────────────────────
  // From photo: "Cust ID: #30" — this is the customer's internal unit number
  const equipment_reference = firstMatch(text, [
    /Cust(?:omer)?\s+ID\s*:?\s*(#\s*\d{1,5})/i,
    /Unit\s*#\s*:?\s*(\d{1,5})/i,
    /Truck\s*#\s*:?\s*(\d{1,5})/i,
    /#\s*(\d{2,4})\b/,
  ])
  if (equipment_reference) found.push("equipment_reference")

  // ── Technician ─────────────────────────────────────────────────────────────
  // From photo: "Technician:     Andrew Cotter"
  // The label and name appear on the same line in the extracted text
  const techRaw = firstMatch(text, [
    /Technician\s*:?\s+([A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+)+)/,
    /Tech(?:nician)?\s*:\s*([A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+)+)/,
    /Service\s+Tech(?:nician)?\s*:?\s+([A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+)+)/,
    /Performed\s+by\s*:?\s+([A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+)+)/,
  ])
  const technician = techRaw?.trim() ?? null
  if (technician) found.push("technician")

  // ── Equipment Hours ────────────────────────────────────────────────────────
  // From photo: "Hours: 20365." on the model/serial line
  const rawHours = firstMatch(text, [
    /Hours\s*:?\s*(\d[\d,]+\.?\d*)/i,
    /Equipment\s+Hours?\s*:?\s*(\d[\d,]+\.?\d*)/i,
    /Equip\.?\s*Hrs?\s*:?\s*(\d[\d,]+\.?\d*)/i,
    /Hour\s+Meter\s*:?\s*(\d[\d,]+\.?\d*)/i,
    /Meter\s+Reading\s*:?\s*(\d[\d,]+\.?\d*)/i,
  ])
  const equipment_hours = rawHours
    ? parseFloat(rawHours.replace(/,/g, ""))
    : null
  if (equipment_hours !== null && equipment_hours > 0) found.push("equipment_hours")

  // ── Date Completed ─────────────────────────────────────────────────────────
  // From photo: "Date Completed: 06/12/2025"
  const rawDate = firstMatch(text, [
    /Date\s+Completed\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /Completion\s+Date\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /Date\s+of\s+Service\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /Service\s+Date\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /Date\s+Started\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/,
    /\b(\d{4}-\d{2}-\d{2})\b/,
  ])
  let date_completed: string | null = null
  if (rawDate) {
    try {
      const d = new Date(rawDate)
      if (!isNaN(d.getTime())) {
        date_completed = d.toISOString().slice(0, 10)
        found.push("date_completed")
      }
    } catch { /**/ }
  }
  if (!date_completed) {
    date_completed = new Date().toISOString().slice(0, 10)
    warnings.push("Date not found — defaulting to today")
  }

  // ── Labor Hours ────────────────────────────────────────────────────────────
  // From photo: "Total Labor Hours: 0.50" at the bottom
  const rawLabor = firstMatch(text, [
    /Total\s+Labor\s+Hours?\s*:?\s*(\d+\.?\d*)/i,
    /Labor\s+Hours?\s*:?\s*(\d+\.?\d*)/i,
    /Labour\s+Hours?\s*:?\s*(\d+\.?\d*)/i,
    /Billed\s+Hours?\s*:?\s*(\d+\.?\d*)/i,
  ])
  const total_labor_hours = rawLabor ? parseFloat(rawLabor) : null
  if (total_labor_hours !== null) found.push("total_labor_hours")

  // ── Service Request Description ────────────────────────────────────────────
  // From photo: "Service Request Description    Screw for door behind operator"
  // Label and text are on the same line with multiple spaces as separator.
  // The section ends at "Repair Action Code" (next black header bar).
  const service_request_description = firstMatch(text, [
    /Service\s+Request\s+Description\s{2,}(.{10,400}?)(?=\s{2,}Repair\s+Action|\nRepair\s+Action|$)/i,
    /Service\s+Request\s+Description[\s:]+(.{10,400}?)(?:\n|Repair\s+Action|$)/i,
    /Service\s+Request\s*:?\s+(.{10,400}?)(?:\n|$)/i,
    /Customer\s+(?:Request|Complaint|Issue)\s*:?\s+(.{10,300}?)(?:\n|$)/i,
    /Reason\s+for\s+Service\s*:?\s+(.{10,300}?)(?:\n|$)/i,
  ])

  // ── Repair Action ──────────────────────────────────────────────────────────
  // From photo: "Repair Action Code    Installed and Adjusted Door"
  // Same-line layout in extracted text: label + spaces + content
  const repair_action_label = firstMatch(text, [
    /Repair\s+Action\s+Code\s{2,}(.{5,200}?)(?=\s{2,}Service\s+Performed|\nService\s+Performed|$)/i,
    /Repair\s+Action\s+Code[\s:]+(.{5,200}?)(?:\n|Service\s+Performed|$)/i,
    /Repair\s+Action\s+(?:Code\s+)?(.{5,200}?)(?:\n|Service\s+Performed|$)/i,
    /Action\s+Code\s*:?\s+(.{5,200}?)(?:\n|$)/i,
  ])

  // ── Service Performed ──────────────────────────────────────────────────────
  // From photo: "Service Performed    Old screw what stripped out..."
  // Same-line layout. Section ends at Part Number table, Total Labor, or signature.
  let service_performed: string | null = null
  const spMatch = /Service\s+Performed\s{2,}([\s\S]{20,1200}?)(?:Part\s+Number\s+Description|Total\s+Labor\s+Hours|Cust(?:omer)?\s+Signature|$$)/i.exec(text)
    ?? /Service\s+Performed[\s:]+([\s\S]{20,1200}?)(?:Part\s+Number|Total\s+Labor|Signature|$)/i.exec(text)
  if (spMatch) {
    service_performed = spMatch[1].trim().replace(/\n+/g, " ").slice(0, 800)
    if (service_performed.length >= 20) found.push("service_performed")
    else service_performed = null
  }

  // ── Issues ─────────────────────────────────────────────────────────────────
  // Run keyword detection over the full text including service performed
  const issues = detectIssues(text)
  if (issues.length === 0 && work_order_type === "PM") issues.push("planned_maintenance")
  if (issues.length > 0) found.push("issues")

  // ── Problem flag ───────────────────────────────────────────────────────────
  const problem_note_flag =
    /problem\s+note|safety\s+issue|must\s+repair|tagged\s+out|out\s+of\s+service|safety\s+concern/i.test(text) ? 1 : 0

  // ── Confidence ─────────────────────────────────────────────────────────────
  // Anchor: having BOTH work_order_no and serial_number means we got real data
  // from the PDF. Extra fields improve confidence from the base score.
  const hasWO     = found.includes("work_order_no")
  const hasSerial = found.includes("serial_number")
  const extras    = ["technician", "date_completed", "total_labor_hours", "service_performed", "model"]
  const extraCount = extras.filter(f => found.includes(f)).length

  let confidence: number
  if (hasWO && hasSerial) {
    confidence = 0.65 + (extraCount / extras.length) * 0.35
  } else if (hasWO || hasSerial) {
    confidence = 0.45 + (extraCount / extras.length) * 0.30
  } else {
    confidence = (extraCount / extras.length) * 0.30
  }
  confidence = Math.round(confidence * 100) / 100

  // ── Repeat signature ───────────────────────────────────────────────────────
  // Only set if multiple issue codes detected — don't fabricate one
  const repeat_issue_signature =
    issues.length > 1 ? issues.join("|") : null

  const workOrder: WorkOrder = {
    work_order_no,
    work_order_type,
    date_completed,
    technician,
    serial_number,
    equipment_reference: equipment_reference
      ? equipment_reference.replace(/\s+/g, "")
      : null,
    model: model ? model.toUpperCase().replace(/\s+/g, "") : null,
    equipment_hours,
    total_labor_hours,
    service_request_description: service_request_description?.trim() ?? null,
    service_performed,
    repair_action_label: repair_action_label?.trim() ?? null,
    problem_note_flag,
    repeat_asset_key: serial_number,
    repeat_issue_signature,
    source_file_name: file.name,
    imported_at: now,
    issues: issues.join(","),
  }

  return {
    workOrder,
    confidence,
    extractedFields: found,
    warnings,
    debugText: text.slice(0, 1500),
  }
}
