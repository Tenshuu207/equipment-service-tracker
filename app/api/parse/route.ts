/**
 * POST /api/parse
 *
 * Accepts a multipart form upload of a .pdf, .msg, or .eml file.
 * Uses server-side libraries to reliably extract text:
 *   - pdf-parse  → real PDF text extraction (handles font encoding, content streams)
 *   - .msg       → scans for %PDF bytes then runs pdf-parse on the attachment
 *   - .eml       → decodes base64 MIME attachments then runs pdf-parse
 *
 * Returns: { text: string, source: string, attachmentName: string | null }
 *
 * The client parser (lib/parser.ts) already has all the Crown regex logic.
 * This route just provides clean input text so those regexes can fire correctly.
 */

import { NextRequest, NextResponse } from "next/server"
// @ts-ignore — pdf-parse has no bundled type declarations
import pdfParse from "pdf-parse"

export const runtime = "nodejs"  // pdf-parse requires Node, not Edge

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find the first %PDF … %%EOF slice in a raw buffer (covers .msg attachments). */
function findPdfSlice(buf: Buffer): Buffer | null {
  const pdfMagic = Buffer.from([0x25, 0x50, 0x44, 0x46])  // %PDF
  const eofMagic = Buffer.from([0x25, 0x25, 0x45, 0x4F, 0x46])  // %%EOF

  const start = buf.indexOf(pdfMagic)
  if (start === -1) return null

  // Search backward from end for %%EOF
  let end = buf.length
  for (let i = buf.length - eofMagic.length; i > start; i--) {
    if (buf.indexOf(eofMagic, i) === i) {
      end = i + eofMagic.length
      break
    }
  }
  return buf.slice(start, end)
}

/** Decode a base64-encoded MIME attachment from an .eml string. */
function decodeBase64Attachment(eml: string): { data: Buffer; filename: string } | null {
  // Find Content-Disposition: attachment lines
  const parts = eml.split(/\r?\n--/)
  for (const part of parts) {
    if (!/content-disposition:\s*attachment/i.test(part)) continue

    const fnMatch = /filename[*]?=["']?([^"'\r\n;]+)/i.exec(part)
    const filename = fnMatch ? fnMatch[1].trim() : "attachment"

    // Only care about PDF attachments
    if (!filename.toLowerCase().endsWith(".pdf")) continue

    // Find blank line separator then base64 data
    const bodyStart = part.indexOf("\r\n\r\n") !== -1
      ? part.indexOf("\r\n\r\n") + 4
      : part.indexOf("\n\n") + 2
    if (bodyStart < 4) continue

    const b64 = part.slice(bodyStart).replace(/\r?\n/g, "").trim()
    try {
      const data = Buffer.from(b64, "base64")
      if (data.length > 100) return { data, filename }
    } catch {
      continue
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const file = form.get("file")

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    const name = (file as File).name.toLowerCase()
    const buf  = Buffer.from(await (file as File).arrayBuffer())

    let pdfBuffer: Buffer | null = null
    let source   = name
    let attachmentName: string | null = null

    // ── .pdf — direct ────────────────────────────────────────────────────────
    if (name.endsWith(".pdf")) {
      pdfBuffer = buf

    // ── .msg — scan raw bytes for embedded PDF ────────────────────────────
    } else if (name.endsWith(".msg")) {
      pdfBuffer = findPdfSlice(buf)
      if (pdfBuffer) {
        attachmentName = name.replace(/\.msg$/i, ".pdf")
        source         = `${name} (PDF attachment)`
      }

    // ── .eml — decode MIME base64 attachment ──────────────────────────────
    } else if (name.endsWith(".eml")) {
      const text = buf.toString("utf-8")
      const att  = decodeBase64Attachment(text)
      if (att) {
        pdfBuffer      = att.data
        attachmentName = att.filename
        source         = `${name} (${att.filename})`
      } else {
        // No PDF attachment — return the email body text so WO number in
        // subject line can still be parsed
        const bodyMatch = /\r?\n\r?\n([\s\S]+)$/.exec(text)
        return NextResponse.json({
          text:           bodyMatch ? bodyMatch[1].slice(0, 8000) : text.slice(0, 8000),
          source,
          attachmentName: null,
          warning:        "No PDF attachment found — using email body text only",
        })
      }
    }

    if (!pdfBuffer) {
      return NextResponse.json({
        text:           "",
        source,
        attachmentName: null,
        warning:        "Could not locate a PDF in this file",
      })
    }

    // ── Run pdf-parse ─────────────────────────────────────────────────────
    const parsed = await pdfParse(pdfBuffer, {
      // Limit to first 10 pages to avoid processing Crown inspection disclaimer pages
      max: 10,
    })

    return NextResponse.json({
      text:           parsed.text ?? "",
      pages:          parsed.numpages,
      source,
      attachmentName,
    })

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Extraction failed"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
