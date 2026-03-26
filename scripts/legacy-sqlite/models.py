"""
models.py - Data models and enums for the Crown Service Tracking system.

All data classes are plain Python dataclasses — no heavy ORM dependencies.
SQLite interactions are handled in db.py.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from enum import Enum
from typing import Optional


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class WorkOrderType(str, Enum):
    PM = "PM"       # Preventive Maintenance
    W = "W"         # Work / Repair


class FileStatus(str, Enum):
    PENDING      = "pending"
    PROCESSING   = "processing"
    PROCESSED    = "processed"      # v2: renamed from SUCCESS
    NEEDS_REVIEW = "needs_review"   # v2: soft-fail requiring human review
    FAILED       = "failed"
    SKIPPED      = "skipped"


class ImportStatus(str, Enum):
    """Per-work-order import status (stored on work_orders table)."""
    PROCESSED    = "processed"
    NEEDS_REVIEW = "needs_review"
    FAILED       = "failed"


class RunStatus(str, Enum):
    RUNNING   = "running"
    COMPLETED = "completed"
    FAILED    = "failed"


# Canonical issue codes recognized by the system.
# Extend this list as new issue categories emerge.
class IssueCode(str, Enum):
    # Wheels & Tires — seen: "load wheels", "asile guide wheels", "drive wheel"
    LOAD_WHEEL          = "load_wheel"
    GUIDE_WHEEL         = "guide_wheel"         # "asile guide wheel" in real docs
    DRIVE_WHEEL         = "drive_wheel"
    CASTER_WHEEL        = "caster_wheel"

    # Throttle / Controls — seen: "throttle issues", "inconsistent throttle control",
    #   "Repaired Control Handle", "POT1", "Forward/Reverse Switch"
    THROTTLE_CONTROLS   = "throttle_controls"

    # Battery / Electrical — seen: "remove battery", "thermal resistor", "re-solder",
    #   "green wire broke", "THROTTLE VOLTAGE OUTSIDE LIMITS"
    BATTERY_ELECTRICAL  = "battery_electrical"

    # Floor / Platform — seen: "platform mat", "floor pad", "floor board"
    FLOOR_PLATFORM      = "floor_platform"

    # Load Backrest — seen: "load back rest", "Inspected Load Backrest",
    #   "transfer the load back rest"
    LOAD_BACKREST       = "load_backrest"

    # Planned Maintenance — seen: "Planned Maintenance for Electric Unit",
    #   "Billing Folder: Planned Maint", PM###### work order prefix
    PLANNED_MAINTENANCE = "planned_maintenance"

    # Brakes
    BRAKES              = "brakes"

    # Hydraulics / Mast / Forks
    HYDRAULICS          = "hydraulics"
    MAST                = "mast"
    FORKS               = "forks"

    # Steering
    STEERING            = "steering"

    # Horn / Lights
    HORN                = "horn"
    LIGHTS              = "lights"

    # Seat / Operator Presence
    SEAT                = "seat"

    # Charger
    CHARGER             = "charger"

    # Overhead Guard
    OVERHEAD_GUARD      = "overhead_guard"

    # Scrap / Decommission — seen: "prep lift truck for scrap"
    DECOMMISSION        = "decommission"

    # Catch-all
    OTHER               = "other"


# ---------------------------------------------------------------------------
# Issue keyword map — tuned to real Crown service note language
# ---------------------------------------------------------------------------
# Keys are IssueCode values; values are lowercase search terms.
# First match wins per code (no need to check all keywords once one matches).

ISSUE_KEYWORD_MAP: dict[str, list[str]] = {
    IssueCode.LOAD_WHEEL: [
        "load wheel",
        "load whl",
        "load roller",
        "load wheel asm",           # part description pattern
        "wheel & bearing asm",      # part: WHEEL & BEARING ASM (4.00 DIA)
        "wheel asm",
        "installed load wheel",
        "removed front load wheel",
    ],
    IssueCode.GUIDE_WHEEL: [
        "guide wheel",
        "guide whl",
        "asile guide wheel",        # real spelling seen in docs: "asile gudie wheels"
        "aisle guide wheel",
        "asile gudie wheel",        # typo as seen in document W135041
        "guide wheel asm",
    ],
    IssueCode.DRIVE_WHEEL: [
        "drive wheel",
        "drive whl",
        "drive tire",
    ],
    IssueCode.CASTER_WHEEL: [
        "caster",
        "caster wheel",
        "caster asm",
    ],
    IssueCode.THROTTLE_CONTROLS: [
        "throttle",
        "inconsistent throttle",
        "throttle voltage",
        "pot1",                     # potentiometer accelerator — part 133457 ASM POTENTIOMETER ACCELERATOR
        "potentiometer",
        "accelerator",
        "control handle",
        "repaired control handle",
        "forward switch",
        "reverse switch",
        "twist grip",
        "re-centering",
        "spring and bushing",       # bushing mold / spring torsion repairs on throttle
        "bushing mold",
        "spring torsion",
        "bushing split",
    ],
    IssueCode.BATTERY_ELECTRICAL: [
        "battery",
        "electrical",
        "battery lifting device",
        "thermal resistor",
        "re-solder",
        "resoldered",
        "green wire",
        "solder point",
        "voltage outside limits",
        "throttle voltage outside", # event code 336
        "wiring",
        "connector",
        "fuse",
        "bdi",
        "battery discharge",
        "charger",
        "charging",
        "electric",
        "remove battery",
        "pull battery",
    ],
    IssueCode.FLOOR_PLATFORM: [
        "floor pad",
        "platform mat",
        "floor board",
        "floor pad",
        "mat platform",             # part description: MAT PLATFORM 42
        "adhesive",                 # adhesive used for floor pad install
        "damaged floor pad",
        "remove and replace platform",
        "remove platform",
    ],
    IssueCode.LOAD_BACKREST: [
        "load back rest",
        "load backrest",
        "backrest",
        "load back",
        "inspected load backrest",
        "transfer the load back rest",
    ],
    IssueCode.PLANNED_MAINTENANCE: [
        "planned maintenance",
        "planned maint",
        "preventive maintenance",
        "grease all fittings",
        "greased all fittings",
        "checked all adjustment",
        "blew the truck off",
        "removed all covers",
        "removed doors and blew",
        "wiped down",
        "returned to service",
        "test drove",
    ],
    IssueCode.DECOMMISSION: [
        "prep lift truck for scrap",
        "scrapping",
        "decommission",
        "for scrap",
        "remove commonly used parts",
        "remove all access modules",
        "access modules",
    ],
    IssueCode.BRAKES: [
        "brake",
        "brakes",
        "parking brake",
        "brake pad",
        "brake assembly",
    ],
    IssueCode.HYDRAULICS: [
        "hydraulic",
        "hyd ",
        "cylinder",
        "oil leak",
        "hydraulic fluid",
        "lift cylinder",
    ],
    IssueCode.MAST: [
        "mast",
        "lift chain",
        "chain",
        "carriage",
        "mast assembly",
    ],
    IssueCode.FORKS: [
        "fork",
        "forks",
        "fork tine",
    ],
    IssueCode.STEERING: [
        "steer",
        "steering",
        "steering wheel",
        "steering assembly",
    ],
    IssueCode.HORN: [
        "horn",
    ],
    IssueCode.LIGHTS: [
        "light",
        "lights",
        "lamp",
        "strobe",
        "headlight",
    ],
    IssueCode.SEAT: [
        "seat",
        "seat switch",
        "operator seat",
        "operator presence",
    ],
    IssueCode.OVERHEAD_GUARD: [
        "overhead guard",
        "ovhd guard",
        "overhead guard asm",
    ],
}


# ---------------------------------------------------------------------------
# Data Classes
# ---------------------------------------------------------------------------

@dataclass
class IngestionSource:
    """A configured folder-based ingestion source."""
    name: str
    folder_path: str
    enabled: bool = True
    allowed_types: str = ".pdf,.eml,.msg"   # comma-separated
    processed_folder: Optional[str] = None  # None = auto-derive from folder_path
    failed_folder: Optional[str] = None     # None = auto-derive from folder_path
    recursive: bool = False
    id: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    @property
    def allowed_extensions(self) -> set[str]:
        return {ext.strip().lower() for ext in self.allowed_types.split(",")}


@dataclass
class EmailMetadata:
    """Email header metadata extracted from .eml files."""
    import_file_id: int
    subject: Optional[str] = None
    sender: Optional[str] = None
    sent_date: Optional[str] = None
    attachment_filename: Optional[str] = None
    id: Optional[int] = None


@dataclass
class Asset:
    serial_number: str
    equipment_reference: Optional[str] = None
    model: Optional[str] = None
    customer_name: Optional[str] = None
    billing_folder: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    def __post_init__(self) -> None:
        """Ensure serial_number is clean."""
        self.serial_number = self.serial_number.strip() if self.serial_number else ""


@dataclass
class WorkOrder:
    work_order_no: str
    work_order_type: Optional[str] = None
    date_completed: Optional[date] = None
    technician: Optional[str] = None
    serial_number: Optional[str] = None
    equipment_reference: Optional[str] = None
    model: Optional[str] = None
    equipment_hours: Optional[float] = None
    total_labor_hours: Optional[float] = None
    service_request_description: Optional[str] = None
    service_performed: Optional[str] = None
    repair_action_label: Optional[str] = None
    problem_note_flag: bool = False
    repeat_asset_key: Optional[str] = None
    repeat_issue_signature: Optional[str] = None
    source_file_name: Optional[str] = None
    source_file_hash: Optional[str] = None
    imported_at: Optional[datetime] = None
    # v2 fields
    import_status: str = ImportStatus.PROCESSED
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    review_notes: Optional[str] = None
    parser_confidence: Optional[float] = None
    duplicate_hash_warning: bool = False
    # Detected issue codes (not stored in this table, goes to work_order_issues)
    issues: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.work_order_no = self.work_order_no.strip() if self.work_order_no else ""
        if self.serial_number:
            self.serial_number = self.serial_number.strip()


@dataclass
class WorkOrderIssue:
    work_order_no: str
    issue_code: str
    id: Optional[int] = None
    created_at: Optional[datetime] = None


@dataclass
class ImportRun:
    id: Optional[int] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    files_processed: int = 0
    files_failed: int = 0
    status: str = RunStatus.RUNNING


@dataclass
class ImportFile:
    import_run_id: int
    file_name: str
    id: Optional[int] = None
    file_path: Optional[str] = None
    file_hash: Optional[str] = None
    status: str = FileStatus.PENDING
    error_message: Optional[str] = None
    processed_at: Optional[datetime] = None


@dataclass
class ParsedDocument:
    """
    The output contract that parser.py must return.
    Importer will validate and normalize this before writing to DB.
    """
    work_order: WorkOrder
    asset: Asset
    raw_issues: list[str] = field(default_factory=list)    # free-text issue strings from PDF
    source_file_name: str = ""
    source_file_hash: str = ""
    parse_warnings: list[str] = field(default_factory=list)
    # v2 additions
    email_metadata: Optional[EmailMetadata] = None          # populated for .eml files
    parser_confidence: float = 1.0                          # 0.0–1.0; below threshold => needs_review
