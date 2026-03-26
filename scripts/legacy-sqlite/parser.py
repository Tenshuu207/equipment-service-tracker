"""
parser.py - Crown Lift Trucks service confirmation parser.

Tuned to the exact Crown service confirmation PDF layout observed in real documents:

  HEADER ROW (top right):
    Work Order No.: W138240    Seg: 1

  LEFT COLUMN (Crown branch info):
    165 Innovation Way
    Scarborough, ME 04074
    TEL: ...  FAX: ...
    Branch: 721

  CENTER COLUMN (customer info):
    Dennis Food Service
    Customer: 132397
    101 Mecaw Rd
    Hampden, ME 04444
    TEL: 207-947-0321
    [optional: contact name]

  RIGHT COLUMN (order info):
    Date Started:    MM/DD/YYYY
    Date Completed:  MM/DD/YYYY
    Purchase Order:  [blank or value]
    Technician:      Justin Cote
    Van:             V-022
    Billing Folder:  Cust Pay

  EQUIPMENT ROW (single horizontal line):
    Make: CRW    Model: PE4500-60    S/N: 6A286154    Cust ID: #27    Hours: 5394.0

  SECTION HEADERS (black bar + content):
    Service Request Description   [text — blank for PM orders]
    Repair Action Code            [text]
    Service Performed             [multi-line text]

  PARTS TABLE:
    Part Number    Description    Quantity
    089510         BUSHING MOLD   2.0
    ...
    Total Labor Hours: 4.00

  WORK ORDER TYPE (derived from number prefix):
    PM######  => Planned Maintenance
    W######   => Repair / Work Order

Dependencies:
    pip install pdfplumber extract-msg python-dateutil
"""

from __future__ import annotations

import hashlib
import logging
import re
from pathlib import Path
from typing import Optional

from models import (
    Asset,
    WorkOrder,
    WorkOrderType,
    ParsedDocument,
    EmailMetadata,
    ImportStatus,
    ISSUE_KEYWORD_MAP,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def parse_file(file_path: Path) -> ParsedDocument:
    """
    Entry point for importer.py.
    Dispatches by extension: .pdf, .eml, or .msg
    Returns a fully populated ParsedDocument with confidence score and email metadata.
    """
    suffix = file_path.suffix.lower()
    file_hash = _compute_hash(file_path)
    email_meta: Optional[EmailMetadata] = None

    if suffix == ".pdf":
        raw_text = _extract_text_from_pdf(file_path)
    elif suffix == ".eml":
        raw_text, email_meta = _extract_from_eml(file_path)
    elif suffix == ".msg":
        raw_text, email_meta = _extract_from_msg(file_path)
    else:
        raise ValueError(f"Unsupported file type: {suffix!r}")

    doc = _parse_crown_service_text(raw_text)
    doc.source_file_name = file_path.name
    doc.source_file_hash = file_hash
    doc.work_order.source_file_name = file_path.name
    doc.work_order.source_file_hash = file_hash
    doc.work_order.parser_confidence = doc.parser_confidence

    # Attach email metadata (import_file_id will be filled in by importer after file record created)
    if email_meta is not None:
        doc.email_metadata = email_meta

    return doc


# ---------------------------------------------------------------------------
# Text Extraction
# ---------------------------------------------------------------------------

def _extract_text_from_pdf(file_path: Path) -> str:
    """Extract all text from a PDF using pdfplumber."""
    try:
        import pdfplumber
    except ImportError:
        raise ImportError("pip install pdfplumber")

    pages = []
    with pdfplumber.open(str(file_path)) as pdf:
        for page in pdf.pages:
            text = page.extract_text(x_tolerance=3, y_tolerance=3)
            if text:
                pages.append(text)

    full_text = "\n".join(pages)
    if not full_text.strip():
        raise RuntimeError(f"No extractable text in PDF: {file_path.name}")

    logger.debug("PDF extracted %d chars: %s", len(full_text), file_path.name)
    return full_text


def _extract_from_eml(file_path: Path) -> tuple[str, Optional[EmailMetadata]]:
    """
    Extract text AND email metadata from a .eml file (RFC 2822).

    Processing order:
      1. Collect all PDF attachments; parse each with pdfplumber.
      2. If one or more PDF attachments found, return combined text.
      3. If zero PDF attachments, log a clean failure (no plain-body fallback
         for service confirmation documents — body text won't parse).
      4. Always extract and return email header metadata regardless of outcome.
    """
    import email
    from email import policy

    with open(file_path, "rb") as f:
        msg = email.message_from_binary_file(f, policy=policy.default)

    # --- Extract header metadata ---
    subject   = str(msg.get("Subject", "") or "").strip() or None
    sender    = str(msg.get("From",    "") or "").strip() or None
    sent_raw  = str(msg.get("Date",    "") or "").strip() or None
    # import_file_id will be filled in by importer after the file record is created
    meta = EmailMetadata(
        import_file_id=0,  # placeholder — caller must set this
        subject=subject,
        sender=sender,
        sent_date=sent_raw,
        attachment_filename=None,
    )

    # --- Collect PDF attachments ---
    pdf_attachments: list[tuple[str, bytes]] = []   # (filename, raw_bytes)
    for part in msg.walk():
        content_type = part.get_content_type()
        filename = part.get_filename() or ""
        if content_type == "application/pdf" or filename.lower().endswith(".pdf"):
            data = part.get_payload(decode=True)
            if data:
                pdf_attachments.append((filename, data))

    if not pdf_attachments:
        raise RuntimeError(
            f"EML file has no PDF attachment: {file_path.name}. "
            "Only PDF-attached service confirmations are supported. "
            "Email body text is not parsed."
        )

    # --- Parse each PDF attachment ---
    try:
        import pdfplumber
        import io
    except ImportError:
        raise ImportError("pip install pdfplumber")

    pdf_texts: list[str] = []
    first_pdf_name: Optional[str] = None
    for fname, data in pdf_attachments:
        try:
            with pdfplumber.open(io.BytesIO(data)) as pdf:
                for page in pdf.pages:
                    text = page.extract_text(x_tolerance=3, y_tolerance=3)
                    if text:
                        pdf_texts.append(text)
            logger.debug("Extracted PDF attachment %r from EML: %s", fname, file_path.name)
            if first_pdf_name is None:
                first_pdf_name = fname
        except Exception as e:
            logger.warning("Failed to read PDF attachment %r in %s: %s", fname, file_path.name, e)

    if not pdf_texts:
        raise RuntimeError(
            f"PDF attachment(s) found in {file_path.name} but no text could be extracted. "
            "PDF may be image-only/scanned."
        )

    meta.attachment_filename = first_pdf_name
    combined = "\n".join(pdf_texts)
    logger.debug("EML %s: parsed %d PDF attachment(s), %d chars", file_path.name, len(pdf_attachments), len(combined))
    return combined, meta


def _extract_from_msg(file_path: Path) -> tuple[str, Optional[EmailMetadata]]:
    """Extract text AND email metadata from an Outlook .msg file — prefers PDF attachment."""
    try:
        import extract_msg
    except ImportError:
        raise ImportError("pip install extract-msg")

    try:
        import pdfplumber
        import io
    except ImportError:
        raise ImportError("pip install pdfplumber")

    with extract_msg.openMsg(str(file_path)) as msg:
        # Extract header metadata
        subject  = (getattr(msg, "subject", None) or "").strip() or None
        sender   = (getattr(msg, "sender",  None) or "").strip() or None
        sent_raw = str(getattr(msg, "date", None) or "").strip() or None
        meta = EmailMetadata(
            import_file_id=0,
            subject=subject,
            sender=sender,
            sent_date=sent_raw,
            attachment_filename=None,
        )

        pdf_texts: list[str] = []
        first_pdf_name: Optional[str] = None
        for attachment in msg.attachments:
            fname = getattr(attachment, "longFilename", None) or ""
            if fname.lower().endswith(".pdf"):
                try:
                    data = attachment.data
                    with pdfplumber.open(io.BytesIO(data)) as pdf:
                        for page in pdf.pages:
                            text = page.extract_text(x_tolerance=3, y_tolerance=3)
                            if text:
                                pdf_texts.append(text)
                    logger.debug("Extracted PDF attachment %r from MSG: %s", fname, file_path.name)
                    if first_pdf_name is None:
                        first_pdf_name = fname
                except Exception as e:
                    logger.warning("Failed to read PDF attachment %r: %s", fname, e)

        if pdf_texts:
            meta.attachment_filename = first_pdf_name
            return "\n".join(pdf_texts), meta

        body = (getattr(msg, "body", None) or "").strip()
        if not body:
            raise RuntimeError(f"No extractable text in MSG: {file_path.name}")
        return body, meta


# ---------------------------------------------------------------------------
# Core Parser — Crown Service Confirmation Format
# ---------------------------------------------------------------------------

def _parse_crown_service_text(text: str) -> ParsedDocument:
    """
    Parse structured fields from Crown service confirmation text.

    Field extraction is ordered by document layout (top to bottom):
      1. Header: work order number, segment
      2. Right column: dates, technician, van, billing folder
      3. Center column: customer name, customer number
      4. Equipment row: make, model, serial, cust ID, hours
      5. Section blocks: service request description, repair action code,
                         service performed
      6. Footer: total labor hours
    """
    warnings: list[str] = []

    # -----------------------------------------------------------------------
    # 1. Work Order Number  (top right header)
    #    Formats seen: "W138240", "PM118795"
    #    Type is inferred from prefix: PM = planned maint, W = repair
    # -----------------------------------------------------------------------
    work_order_no = _extract(text, [
        r"Work Order No\.[:\s]+([A-Z0-9]+)",
        r"Work Order\s*No[:\s]+([A-Z0-9]+)",
        r"Work Order\s*#[:\s]+([A-Z0-9]+)",
    ])
    if not work_order_no:
        raise RuntimeError("Could not find Work Order No. in document.")

    work_order_no = work_order_no.strip().upper()
    work_order_type = _infer_wo_type(work_order_no)

    # -----------------------------------------------------------------------
    # 2. Dates
    #    "Date Started:    12/04/2025"
    #    "Date Completed:  12/05/2025"
    # -----------------------------------------------------------------------
    date_started_raw = _extract(text, [
        r"Date Started[:\s]+([\d]{1,2}/[\d]{1,2}/[\d]{2,4})",
    ])
    date_completed_raw = _extract(text, [
        r"Date Completed[:\s]+([\d]{1,2}/[\d]{1,2}/[\d]{2,4})",
    ])
    date_completed = _parse_date(date_completed_raw)
    if date_completed_raw and not date_completed:
        warnings.append(f"Could not parse Date Completed: {date_completed_raw!r}")

    # -----------------------------------------------------------------------
    # 3. Technician / Van / Billing Folder
    #    "Technician:   Justin Cote"
    #    "Van:          V-022"
    #    "Billing Folder: Cust Pay"
    # -----------------------------------------------------------------------
    technician = _extract(text, [
        r"Technician[:\s]+([A-Za-z][A-Za-z ,\.'-]+?)(?:\n|Van:|$)",
    ])
    if technician:
        technician = re.sub(r"\s+", " ", technician).strip().rstrip(",")

    van = _extract(text, [
        r"Van[:\s]+(V-\d+)",
    ])

    billing_folder = _extract(text, [
        # "Billing Folder:  Cust Pay" — value may be multi-word, ends at newline
        r"Billing Folder[:\s]+(.+?)(?:\n|$)",
    ])
    if billing_folder:
        billing_folder = billing_folder.strip()

    # -----------------------------------------------------------------------
    # 4. Customer Info
    #    Center column — "Dennis Food Service" is on its own line,
    #    followed by "Customer: 132397"
    # -----------------------------------------------------------------------
    customer_name = _extract(text, [
        # Customer name appears before "Customer: <number>" line
        r"(Dennis[^\n]+)\nCustomer[:\s]+\d+",
        r"Customer Name[:\s]+(.+?)(?:\n|$)",
    ])
    if customer_name:
        customer_name = customer_name.strip()

    customer_number = _extract(text, [
        r"Customer[:\s]+(\d{4,8})(?:\s|$|\n)",
    ])

    # -----------------------------------------------------------------------
    # 5. Equipment Row
    #    "Make: CRW    Model: PE4500-60    S/N: 6A286154    Cust ID: #27    Hours: 5394.0"
    #    All on one horizontal line — pdfplumber preserves this.
    # -----------------------------------------------------------------------
    model = _extract(text, [
        r"Model[:\s]+([A-Z0-9]{2,5}[\d]{3,4}-[\d]{2,3}[A-Z]?)",   # PE4500-60, SP3520-30
        r"Model[:\s]+([A-Z0-9\-]+?)(?:\s{2,}|S/N|$)",
    ])
    if model:
        model = model.strip().upper()

    serial_number = _extract(text, [
        # Real serials: 6A286154, 1A460250, 10183427, 1A384086, 6A276850, 6A286153
        r"S/N[:\s]+([0-9A-Z]{6,12})(?:\s|$|\n|Cust)",
        r"Serial\s*(?:No|Number|#)?[:\s]+([0-9A-Z]{6,12})",
    ])
    if serial_number:
        serial_number = _clean_serial(serial_number)

    cust_id = _extract(text, [
        # "Cust ID: #27"  — the # is part of the value on the document
        r"Cust ID[:\s]+#?(\d+)",
    ])

    equipment_hours = _parse_float(_extract(text, [
        r"Hours[:\s]+([\d,]+\.?\d*)\s*(?:\n|$|Seg)",
    ]))

    # -----------------------------------------------------------------------
    # 6. Section Blocks — bounded by black header bars
    #    The PDF renders these as lines like:
    #      "Service Request Description   Prep lift truck for scrap"
    #    or sometimes the content is on the next line.
    #
    #    We handle both inline and next-line formats.
    # -----------------------------------------------------------------------
    service_request_description = _extract_section(text, [
        "Service Request Description",
        "Service Request",
    ])
    # Strip embedded tracking/barcode strings (e.g. "1ZXX85790377920333")
    if service_request_description:
        service_request_description = _strip_barcodes(service_request_description)
        service_request_description = service_request_description.strip() or None

    repair_action_label = _extract_section(text, [
        "Repair Action Code",
        "Repair Action",
    ])

    service_performed = _extract_section(text, [
        "Service Performed",
        "Work Performed",
    ])
    # Strip parts table header if it leaked into service performed text
    if service_performed:
        service_performed = re.sub(
            r"Part Number\s+Description\s+Quantity.*$", "", service_performed,
            flags=re.DOTALL | re.IGNORECASE,
        ).strip() or None

    # -----------------------------------------------------------------------
    # 7. Total Labor Hours (bottom right of document)
    #    "Total Labor Hours: 3.0" or "Total Labor Hours: 4.00"
    # -----------------------------------------------------------------------
    total_labor_hours = _parse_float(_extract(text, [
        r"Total Labor Hours[:\s]+([\d]+\.[\d]+)",
        r"Total Labor Hours[:\s]+([\d]+)",
    ]))

    # -----------------------------------------------------------------------
    # 8. Equipment Reference (Cust ID field = internal equipment number)
    #    "Cust ID: #27" means this is unit #27 in the customer's fleet.
    #    We use this as equipment_reference.
    # -----------------------------------------------------------------------
    equipment_reference = f"#{cust_id}" if cust_id else None

    # -----------------------------------------------------------------------
    # 9. Issue Detection
    #    Scan Service Request Description + Service Performed + Repair Action
    # -----------------------------------------------------------------------
    combined = " ".join(filter(None, [
        service_request_description,
        service_performed,
        repair_action_label,
    ])).lower()

    detected_issues = _detect_issues(combined)

    # Do not allow PM tagging on non-PM work orders
    if work_order_type != WorkOrderType.PM and "planned_maintenance" in detected_issues:
        detected_issues = [i for i in detected_issues if i != "planned_maintenance"]

    # Problem flag: safety mentions, "down", recurring language
    problem_note_flag = _detect_problem_flag(combined)

    # Repeat asset key = serial number (used for cross-WO repeat detection in DB)
    repeat_asset_key = serial_number or None

    # Repeat issue signature built from sorted issue codes
    repeat_issue_signature = "|".join(sorted(detected_issues)) if detected_issues else None

    # -----------------------------------------------------------------------
    # 10. Assemble dataclasses
    # -----------------------------------------------------------------------
    work_order = WorkOrder(
        work_order_no=work_order_no,
        work_order_type=work_order_type,
        date_completed=date_completed,
        technician=technician,
        serial_number=serial_number,
        equipment_reference=equipment_reference,
        model=model,
        equipment_hours=equipment_hours,
        total_labor_hours=total_labor_hours,
        service_request_description=service_request_description,
        service_performed=service_performed,
        repair_action_label=repair_action_label,
        problem_note_flag=problem_note_flag,
        repeat_asset_key=repeat_asset_key,
        repeat_issue_signature=repeat_issue_signature,
        issues=detected_issues,
    )

    asset = Asset(
        serial_number=serial_number or f"UNKNOWN_{work_order_no}",
        equipment_reference=equipment_reference,
        model=model,
        customer_name=customer_name,
        billing_folder=billing_folder,
    )

    # -----------------------------------------------------------------------
    # 11. Confidence scoring — determines needs_review routing
    #
    #     Deduct from 1.0 for each red flag:
    #       -0.30  serial number missing or fallback UNKNOWN_
    #       -0.20  model missing
    #       -0.20  date_completed missing
    #       -0.10  technician missing
    #       -0.15  no issues detected (possibly a PM with no service text)
    # -----------------------------------------------------------------------
    confidence = 1.0
    review_reasons: list[str] = []

    if not serial_number or serial_number.startswith("UNKNOWN_"):
        confidence -= 0.30
        review_reasons.append("serial number missing or suspicious")
    if not model:
        confidence -= 0.20
        review_reasons.append("model missing")
    if not date_completed:
        confidence -= 0.20
        review_reasons.append("date_completed missing")
    if not technician:
        confidence -= 0.10
        review_reasons.append("technician missing")
    if not detected_issues and work_order_type == WorkOrderType.W:
        confidence -= 0.15
        review_reasons.append("no issue codes detected on W-type work order")

    confidence = max(0.0, round(confidence, 2))

    # Threshold: anything below 0.70 goes to needs_review
    CONFIDENCE_THRESHOLD = 0.70
    wo_import_status = (
        ImportStatus.NEEDS_REVIEW if confidence < CONFIDENCE_THRESHOLD
        else ImportStatus.PROCESSED
    )
    if review_reasons:
        for r in review_reasons:
            warnings.append(f"Review flag: {r}")
        if wo_import_status == ImportStatus.NEEDS_REVIEW:
            logger.info(
                "WO %s → needs_review (confidence=%.2f): %s",
                work_order_no, confidence, "; ".join(review_reasons),
            )

    work_order.import_status = wo_import_status
    work_order.parser_confidence = confidence

    return ParsedDocument(
        work_order=work_order,
        asset=asset,
        raw_issues=[combined],
        parse_warnings=warnings,
        parser_confidence=confidence,
    )


# ---------------------------------------------------------------------------
# Section Block Extractor
# ---------------------------------------------------------------------------

# All known section header names in order of appearance
_SECTION_HEADERS = [
    "Service Request Description",
    "Service Request",
    "Repair Action Code",
    "Repair Action",
    "Service Performed",
    "Work Performed",
    "Part Number",         # parts table — signals end of service performed
    "Total Labor Hours",
]

def _extract_section(text: str, header_variants: list[str]) -> Optional[str]:
    """
    Extract the text content of a Crown service section block.

    Crown PDFs have black header bars with white text, rendered as:
      "Service Request Description   Prep lift truck for scrap"
    or:
      "Service Request Description\nPrep lift truck for scrap\n..."

    Content ends at the next section header or end of document.
    """
    for header in header_variants:
        # Build a pattern that matches the header and captures what follows,
        # up to the next known section header or end of text.
        stop = "|".join(
            re.escape(h) for h in _SECTION_HEADERS
            if h.lower() != header.lower()
        )
        pattern = (
            rf"{re.escape(header)}"
            rf"[ \t]*(.*?)(?={stop}|\Z)"
        )
        match = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
        if match:
            raw = match.group(1).strip()
            # Collapse excessive whitespace but keep it readable
            raw = re.sub(r"[ \t]+", " ", raw)         # collapse horizontal space
            raw = re.sub(r"\n{3,}", "\n\n", raw)      # max 2 consecutive newlines
            raw = re.sub(r"[ \t]*\n[ \t]*", " ", raw) # join wrapped lines
            raw = raw.strip()
            return raw if raw else None

    return None


# ---------------------------------------------------------------------------
# Issue Detection
# ---------------------------------------------------------------------------

def _detect_issues(text: str) -> list[str]:
    """Return sorted deduplicated list of IssueCode strings found in text."""
    detected: set[str] = set()
    for code, keywords in ISSUE_KEYWORD_MAP.items():
        for kw in keywords:
            if kw in text:
                detected.add(code)
                break
    return sorted(detected)


def _detect_problem_flag(text: str) -> bool:
    """
    Flag work orders with safety concerns, recurring issues, or significant findings.
    Based on language patterns seen in real Crown service notes.
    """
    patterns = [
        r"safety issue",
        r"cause injur",
        r"down\s+for\s+\d+",        # "down for 24 hours"
        r"truck\s+will\s+be\s+down",
        r"tagged\s+out",
        r"same\s+(issue|problem|repair)",
        r"recurring",
        r"repeat\s+(issue|repair)",
        r"potential",                 # "could potentially cause injury"
        r"green wire.{0,30}broke",   # specific safety issue seen in examples
        r"re-solder",
    ]
    for p in patterns:
        if re.search(p, text, re.IGNORECASE):
            return True
    return False


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _infer_wo_type(work_order_no: str) -> str:
    """
    Determine work order type from the number prefix.
    PM###### = Planned Maintenance
    W######  = Repair / Work Order
    """
    if work_order_no.upper().startswith("PM"):
        return WorkOrderType.PM
    if work_order_no.upper().startswith("W"):
        return WorkOrderType.W
    return WorkOrderType.W  # default fallback


def _clean_serial(raw: str) -> str:
    """
    Keep only the alphanumeric serial number characters.
    Crown serial numbers: 6-10 alphanumeric chars, e.g. 6A286154, 10183427
    """
    raw = raw.strip().upper()
    # Take leading alphanumeric run only
    m = re.match(r"^([A-Z0-9]{6,12})", raw)
    return m.group(1) if m else raw


def _strip_barcodes(text: str) -> str:
    """
    Remove embedded barcode/tracking strings from service description text.
    Pattern: long runs of digits and uppercase letters with no spaces, 12+ chars.
    Example seen: "1ZXX85790377920333" (UPS tracking number embedded in description)
    """
    return re.sub(r"\b[A-Z0-9]{12,}\b", "", text).strip()


def _extract(text: str, patterns: list[str]) -> Optional[str]:
    """Try each regex in order; return first group(1) match, or None."""
    for pattern in patterns:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            return m.group(1).strip()
    return None


def _parse_date(raw: Optional[str]):
    """Parse MM/DD/YYYY into a date object."""
    if not raw:
        return None
    try:
        from dateutil import parser as dp
        return dp.parse(raw, dayfirst=False).date()
    except Exception:
        return None


def _parse_float(raw: Optional[str]) -> Optional[float]:
    if not raw:
        return None
    try:
        return float(raw.replace(",", "").strip())
    except ValueError:
        return None


def _compute_hash(file_path: Path) -> str:
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()
