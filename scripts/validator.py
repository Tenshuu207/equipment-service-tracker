"""
validator.py - Data validation and normalization for parsed Crown service documents.

Responsibilities:
- Validate required fields are present and non-empty
- Normalize values (type coercion, whitespace, case)
- Detect and normalize issue codes from raw text
- Return a list of error strings (empty = valid)
- Mutate the ParsedDocument in-place for normalization

Validation is intentionally strict to surface data quality issues early.
Warnings (non-blocking) are appended to doc.parse_warnings.
"""

from __future__ import annotations

import logging
import re
from typing import Optional

from models import (
    ParsedDocument,
    WorkOrder,
    WorkOrderType,
    IssueCode,
    ISSUE_KEYWORD_MAP,
)

logger = logging.getLogger(__name__)

# Fields that MUST be present for a record to be written to DB
REQUIRED_WORK_ORDER_FIELDS = ["work_order_no"]

# Fields that generate warnings if missing (non-blocking)
RECOMMENDED_WORK_ORDER_FIELDS = [
    "serial_number",
    "date_completed",
    "technician",
    "model",
]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def validate_parsed_document(doc: ParsedDocument) -> list[str]:
    """
    Validate and normalize a ParsedDocument in-place.

    Returns a list of blocking error strings.
    Empty list = document is valid and ready for DB write.
    Warnings are appended to doc.parse_warnings (non-blocking).
    """
    errors: list[str] = []

    # Normalize first (modifies doc in place)
    _normalize_work_order(doc.work_order)
    _normalize_asset(doc.asset)
    _normalize_issues(doc)

    # Then validate required fields
    errors.extend(_validate_required_fields(doc.work_order))

    # Cross-field consistency checks
    errors.extend(_validate_cross_fields(doc))

    # Warnings for recommended fields
    for field in RECOMMENDED_WORK_ORDER_FIELDS:
        val = getattr(doc.work_order, field, None)
        if not val:
            msg = f"Recommended field missing: work_order.{field}"
            logger.debug(msg)
            doc.parse_warnings.append(msg)

    return errors


# ---------------------------------------------------------------------------
# Normalization
# ---------------------------------------------------------------------------

def _normalize_work_order(wo: WorkOrder) -> None:
    """Normalize all work order fields in-place."""

    # work_order_no: uppercase, strip
    if wo.work_order_no:
        wo.work_order_no = wo.work_order_no.strip().upper()

    # work_order_type: uppercase, validate against enum
    if wo.work_order_type:
        raw = wo.work_order_type.strip().upper()
        if raw in (WorkOrderType.PM, WorkOrderType.W):
            wo.work_order_type = raw
        elif any(kw in raw for kw in ("PREV", "PM", "MAINT")):
            wo.work_order_type = WorkOrderType.PM
        elif any(kw in raw for kw in ("WORK", "REPAIR", "W")):
            wo.work_order_type = WorkOrderType.W
        else:
            # Keep original but flag
            wo.work_order_type = raw

    # technician: title-case, remove extra whitespace
    if wo.technician:
        wo.technician = re.sub(r"\s+", " ", wo.technician.strip()).title()

    # serial_number: uppercase, no whitespace
    if wo.serial_number:
        wo.serial_number = re.sub(r"\s+", "", wo.serial_number.strip().upper())

    # equipment_reference: uppercase, strip
    if wo.equipment_reference:
        wo.equipment_reference = wo.equipment_reference.strip().upper()

    # model: uppercase, no spaces (Crown model numbers don't have spaces)
    if wo.model:
        wo.model = re.sub(r"\s+", "", wo.model.strip().upper())

    # equipment_hours: round to 1 decimal
    if wo.equipment_hours is not None:
        wo.equipment_hours = round(float(wo.equipment_hours), 1)

    # total_labor_hours: round to 2 decimals
    if wo.total_labor_hours is not None:
        wo.total_labor_hours = round(float(wo.total_labor_hours), 2)

    # text fields: collapse internal whitespace
    for field in (
        "service_request_description",
        "service_performed",
        "repair_action_label",
        "repeat_issue_signature",
    ):
        val = getattr(wo, field)
        if val:
            setattr(wo, field, re.sub(r"\s+", " ", val.strip()))


def _normalize_asset(asset) -> None:
    """Normalize asset fields in-place."""
    if asset.serial_number:
        asset.serial_number = re.sub(r"\s+", "", asset.serial_number.strip().upper())
    if asset.equipment_reference:
        asset.equipment_reference = asset.equipment_reference.strip().upper()
    if asset.model:
        asset.model = re.sub(r"\s+", "", asset.model.strip().upper())
    if asset.customer_name:
        asset.customer_name = re.sub(r"\s+", " ", asset.customer_name.strip())
    if asset.billing_folder:
        asset.billing_folder = asset.billing_folder.strip()


def _normalize_issues(doc: ParsedDocument) -> None:
    """
    Build a clean, deduplicated list of IssueCode strings on the work order.

    Sources (in priority order):
      1. Issues already detected by parser.py (doc.work_order.issues)
      2. Rescan raw_issues strings against ISSUE_KEYWORD_MAP
    """
    detected: set[str] = set(doc.work_order.issues or [])

    for raw_text in (doc.raw_issues or []):
        lower_text = raw_text.lower()
        for code, keywords in ISSUE_KEYWORD_MAP.items():
            for kw in keywords:
                if kw in lower_text:
                    detected.add(code)
                    break

    # Validate each code against the enum
    validated: list[str] = []
    known_codes = {e.value for e in IssueCode}
    for code in sorted(detected):
        if code in known_codes:
            validated.append(code)
        else:
            logger.debug("Unknown issue code detected (keeping): %s", code)
            validated.append(code)  # Keep unknown codes rather than dropping

    doc.work_order.issues = validated

    # Sync asset key for repeat detection
    if doc.work_order.serial_number and not doc.work_order.repeat_asset_key:
        doc.work_order.repeat_asset_key = doc.work_order.serial_number

    # Build repeat issue signature from sorted issue codes
    if validated and not doc.work_order.repeat_issue_signature:
        doc.work_order.repeat_issue_signature = "|".join(sorted(validated))


# ---------------------------------------------------------------------------
# Validation Rules
# ---------------------------------------------------------------------------

def _validate_required_fields(wo: WorkOrder) -> list[str]:
    errors: list[str] = []
    for field in REQUIRED_WORK_ORDER_FIELDS:
        val = getattr(wo, field, None)
        if not val or (isinstance(val, str) and not val.strip()):
            errors.append(f"Required field is empty: work_order.{field}")
    return errors


def _validate_cross_fields(doc: ParsedDocument) -> list[str]:
    errors: list[str] = []
    wo = doc.work_order

    # Work order number format: should be alphanumeric
    if wo.work_order_no and not re.match(r"^[A-Z0-9\-]+$", wo.work_order_no):
        errors.append(
            f"work_order_no contains unexpected characters: {wo.work_order_no!r}"
        )

    # Serial number on work order must match asset serial number if both present
    if (
        wo.serial_number
        and doc.asset.serial_number
        and wo.serial_number != doc.asset.serial_number
    ):
        # Non-blocking: asset serial takes precedence from doc.asset
        doc.parse_warnings.append(
            f"Serial number mismatch between work_order ({wo.serial_number!r}) "
            f"and asset ({doc.asset.serial_number!r}). Using asset serial."
        )
        wo.serial_number = doc.asset.serial_number

    # Equipment hours should be a positive number
    if wo.equipment_hours is not None and wo.equipment_hours < 0:
        errors.append(f"equipment_hours is negative: {wo.equipment_hours}")

    # Labor hours should be reasonable (< 100 for a single WO)
    if wo.total_labor_hours is not None and wo.total_labor_hours > 100:
        doc.parse_warnings.append(
            f"Unusually high total_labor_hours: {wo.total_labor_hours}"
        )

    return errors
