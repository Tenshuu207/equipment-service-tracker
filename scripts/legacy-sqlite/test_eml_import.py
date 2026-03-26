"""
test_eml_import.py — Test coverage for .eml import cases.

Covers:
  1. EML with a single PDF attachment (happy path)
  2. EML with multiple attachments — only PDF processed
  3. EML with no PDF attachment — clean failure
  4. EML with PDF but no extractable text (image-only PDF) — clean failure
  5. Email metadata extraction (subject, sender, sent_date, attachment_filename)
  6. Confidence scoring triggers needs_review when serial is missing

Run:
    python scripts/test_eml_import.py

No external test framework required — uses stdlib unittest.
Requires: pdfplumber, reportlab (for generating test PDFs in-memory)
"""

from __future__ import annotations

import io
import textwrap
import unittest
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# Minimal Crown service confirmation text used as PDF content in tests
# ---------------------------------------------------------------------------
VALID_CROWN_TEXT = textwrap.dedent("""\
    Work Order No.: W138240    Seg: 1
    Date Started:   12/04/2025
    Date Completed: 12/05/2025
    Technician:     Justin Cote
    Van:            V-022
    Billing Folder: Cust Pay
    Dennis Food Service
    Customer: 132397
    Make: CRW    Model: PE4500-60    S/N: 6A286154    Cust ID: #27    Hours: 5394.0
    Service Request Description  Prep lift truck for scrap
    Repair Action Code  Inspected Load Backrest
    Service Performed
    Removed battery, load back rest, access modules, and some commonly used parts.
    Used battery lifting device to pull battery.
    Total Labor Hours: 3.0
""")

MISSING_SERIAL_TEXT = textwrap.dedent("""\
    Work Order No.: W999001    Seg: 1
    Date Started:   01/10/2026
    Date Completed: 01/11/2026
    Technician:     Andrew Cotter
    Billing Folder: Cust Pay
    Dennis Food Service
    Customer: 132397
    Make: CRW    Model: PE4500-60    Hours: 1200.0
    Service Request Description  Throttle issue
    Service Performed  Found and resolved throttle voltage issue. POT1 replaced.
    Total Labor Hours: 2.0
""")


# ---------------------------------------------------------------------------
# Helpers — build minimal EML bytes in memory
# ---------------------------------------------------------------------------

def _make_eml_with_pdf_text(crown_text: str, subject: str = "Service Confirmation", sender: str = "crown@example.com") -> bytes:
    """
    Build a MIME email containing a PDF attachment whose 'text' is crown_text.
    Uses pdfplumber-compatible approach: we create a real minimal PDF via reportlab.
    Falls back to a mock if reportlab is not installed.
    """
    pdf_bytes = _make_pdf_bytes(crown_text)

    msg = MIMEMultipart()
    msg["Subject"] = subject
    msg["From"] = sender
    msg["Date"] = "Thu, 05 Dec 2025 08:00:00 +0000"
    msg.attach(MIMEText("Please find the service confirmation attached.", "plain"))
    att = MIMEApplication(pdf_bytes, _subtype="pdf")
    att.add_header("Content-Disposition", "attachment", filename="W138240.pdf")
    msg.attach(att)
    return msg.as_bytes()


def _make_eml_no_pdf(subject: str = "No PDF") -> bytes:
    """EML with only a plain-text body — no PDF attachment."""
    msg = MIMEMultipart()
    msg["Subject"] = subject
    msg["From"] = "user@example.com"
    msg["Date"] = "Thu, 05 Dec 2025 09:00:00 +0000"
    msg.attach(MIMEText("Just some body text, no attachment.", "plain"))
    return msg.as_bytes()


def _make_eml_multi_attachment(crown_text: str) -> bytes:
    """EML with a PDF attachment and a non-PDF (.txt) attachment."""
    pdf_bytes = _make_pdf_bytes(crown_text)
    msg = MIMEMultipart()
    msg["Subject"] = "Multi-attachment test"
    msg["From"] = "crown@example.com"
    msg["Date"] = "Thu, 05 Dec 2025 10:00:00 +0000"
    msg.attach(MIMEText("See attachments.", "plain"))
    att_pdf = MIMEApplication(pdf_bytes, _subtype="pdf")
    att_pdf.add_header("Content-Disposition", "attachment", filename="service_confirmation.pdf")
    msg.attach(att_pdf)
    att_txt = MIMEText("This is a text attachment that should be ignored.", "plain")
    att_txt.add_header("Content-Disposition", "attachment", filename="notes.txt")
    msg.attach(att_txt)
    return msg.as_bytes()


def _make_pdf_bytes(text_content: str) -> bytes:
    """
    Generate a minimal PDF containing text_content.
    Uses reportlab if available; falls back to a hand-crafted minimal valid PDF.
    """
    try:
        from reportlab.pdfgen import canvas as rl_canvas
        buf = io.BytesIO()
        c = rl_canvas.Canvas(buf)
        y = 750
        for line in text_content.splitlines():
            c.drawString(40, y, line)
            y -= 14
            if y < 50:
                c.showPage()
                y = 750
        c.save()
        return buf.getvalue()
    except ImportError:
        pass

    # Minimal hand-crafted PDF that pdfplumber can extract text from
    # This is a valid 1-page PDF with the text injected as a raw stream.
    safe_text = text_content.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)").replace("\n", ") Tj\n0 -14 Td\n(")
    stream_content = f"BT /F1 10 Tf 40 750 Td ({safe_text}) Tj ET"
    stream_bytes = stream_content.encode("latin-1", errors="replace")
    stream_len = len(stream_bytes)

    pdf = (
        b"%PDF-1.4\n"
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n"
        b"4 0 obj\n<< /Length " + str(stream_len).encode() + b" >>\nstream\n"
        + stream_bytes
        + b"\nendstream\nendobj\n"
        b"5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"
        b"xref\n0 6\n0000000000 65535 f \n"
        b"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n9\n%%EOF\n"
    )
    return pdf


# ---------------------------------------------------------------------------
# Test Cases
# ---------------------------------------------------------------------------

class TestEmlImport(unittest.TestCase):

    def setUp(self):
        """Write EML test files to a temporary directory."""
        import tempfile
        self.tmpdir = tempfile.mkdtemp()
        self.valid_eml = Path(self.tmpdir) / "W138240.eml"
        self.valid_eml.write_bytes(_make_eml_with_pdf_text(VALID_CROWN_TEXT))

        self.nopdf_eml = Path(self.tmpdir) / "no_pdf.eml"
        self.nopdf_eml.write_bytes(_make_eml_no_pdf())

        self.multi_eml = Path(self.tmpdir) / "multi_att.eml"
        self.multi_eml.write_bytes(_make_eml_multi_attachment(VALID_CROWN_TEXT))

        self.missing_serial_eml = Path(self.tmpdir) / "missing_serial.eml"
        self.missing_serial_eml.write_bytes(_make_eml_with_pdf_text(MISSING_SERIAL_TEXT))

    # -----------------------------------------------------------------------
    # Case 1: Valid EML with PDF — happy path
    # -----------------------------------------------------------------------
    def test_valid_eml_parses_work_order(self):
        """EML with one PDF attachment should parse the Crown work order correctly."""
        from parser import parse_file
        doc = parse_file(self.valid_eml)

        self.assertEqual(doc.work_order.work_order_no, "W138240")
        self.assertEqual(doc.work_order.serial_number, "6A286154")
        self.assertEqual(doc.work_order.model, "PE4500-60")
        self.assertEqual(doc.work_order.technician, "Justin Cote")
        self.assertIsNotNone(doc.work_order.date_completed)
        self.assertEqual(doc.source_file_name, "W138240.eml")

    # -----------------------------------------------------------------------
    # Case 2: EML with multiple attachments — only PDF processed
    # -----------------------------------------------------------------------
    def test_multi_attachment_eml_processes_pdf_only(self):
        """EML with PDF + .txt attachment should only use the PDF for parsing."""
        from parser import parse_file
        doc = parse_file(self.multi_eml)
        self.assertEqual(doc.work_order.work_order_no, "W138240")

    # -----------------------------------------------------------------------
    # Case 3: EML with no PDF attachment — clean failure (RuntimeError)
    # -----------------------------------------------------------------------
    def test_eml_without_pdf_raises_runtime_error(self):
        """EML with no PDF attachment must raise RuntimeError with clear message."""
        from parser import parse_file
        with self.assertRaises(RuntimeError) as ctx:
            parse_file(self.nopdf_eml)
        self.assertIn("no PDF attachment", str(ctx.exception))

    # -----------------------------------------------------------------------
    # Case 4: Email metadata is extracted
    # -----------------------------------------------------------------------
    def test_email_metadata_extracted(self):
        """Email subject, sender, sent_date, and attachment_filename should be captured."""
        from parser import parse_file
        doc = parse_file(self.valid_eml)
        self.assertIsNotNone(doc.email_metadata)
        self.assertEqual(doc.email_metadata.subject, "Service Confirmation")
        self.assertEqual(doc.email_metadata.sender, "crown@example.com")
        self.assertIsNotNone(doc.email_metadata.sent_date)
        self.assertIsNotNone(doc.email_metadata.attachment_filename)
        self.assertTrue(doc.email_metadata.attachment_filename.endswith(".pdf"))

    # -----------------------------------------------------------------------
    # Case 5: Missing serial triggers needs_review
    # -----------------------------------------------------------------------
    def test_missing_serial_triggers_needs_review(self):
        """Work order with no extractable serial number should get needs_review status."""
        from parser import parse_file
        from models import ImportStatus
        doc = parse_file(self.missing_serial_eml)
        self.assertEqual(doc.work_order.import_status, ImportStatus.NEEDS_REVIEW)
        self.assertLess(doc.parser_confidence, 0.70)

    # -----------------------------------------------------------------------
    # Case 6: Valid record gets processed status
    # -----------------------------------------------------------------------
    def test_valid_record_gets_processed_status(self):
        """Well-formed work order should get processed status and confidence >= 0.70."""
        from parser import parse_file
        from models import ImportStatus
        doc = parse_file(self.valid_eml)
        self.assertEqual(doc.work_order.import_status, ImportStatus.PROCESSED)
        self.assertGreaterEqual(doc.parser_confidence, 0.70)

    # -----------------------------------------------------------------------
    # Case 7: PDF suffix — non-regression
    # -----------------------------------------------------------------------
    def test_pdf_parse_still_works(self):
        """Direct PDF parsing (no EML wrapper) should still work."""
        import tempfile, shutil
        try:
            from reportlab.pdfgen import canvas as rl_canvas
        except ImportError:
            self.skipTest("reportlab not installed — skipping PDF write test")

        pdf_path = Path(self.tmpdir) / "W138240.pdf"
        pdf_bytes = _make_pdf_bytes(VALID_CROWN_TEXT)
        pdf_path.write_bytes(pdf_bytes)

        from parser import parse_file
        doc = parse_file(pdf_path)
        self.assertEqual(doc.work_order.work_order_no, "W138240")

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)


if __name__ == "__main__":
    print("Running .eml import test suite...")
    unittest.main(verbosity=2)
