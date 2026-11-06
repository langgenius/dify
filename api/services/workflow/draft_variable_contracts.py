"""Plain records and commands crossing the draft-variable persistence and file ports."""

from dataclasses import dataclass, field
from uuid import uuid4

from graphon.variables import Segment, SegmentType


@dataclass(frozen=True, slots=True)
class DraftVariableCreator:
    """Account identity used to attribute a debug upload; its tenant is supplied separately."""

    id: str


@dataclass(frozen=True, slots=True)
class DraftUploadRecord:
    """Identity of an independently committed upload, usable for durable cleanup after save failure."""

    id: str


@dataclass(frozen=True, slots=True)
class DraftVariableFileRecord:
    """Materialized offloaded content; storage_key=None means its upload is unavailable."""

    id: str
    upload_file_id: str
    value_type: SegmentType
    storage_key: str | None


@dataclass(frozen=True, slots=True)
class DraftVariableRecord:
    """Stored variable facts; file_id=None means inline, variable_file=None means missing metadata."""

    id: str
    node_id: str
    name: str
    description: str
    selector: tuple[str, ...]
    value_type: SegmentType
    value: str
    file_id: str | None
    variable_file: DraftVariableFileRecord | None


@dataclass(frozen=True, slots=True, kw_only=True)
class DraftVariableWriteCommand:
    """One output upsert; node_execution_id=None identifies a conversation variable.

    file_id=None keeps the value inline; otherwise it references offloaded-file metadata
    saved in the same transaction. The repository assigns fresh persistence timestamps.
    """

    app_id: str
    user_id: str
    node_id: str
    name: str
    value: Segment
    node_execution_id: str | None
    description: str = ""
    visible: bool = True
    editable: bool = True
    file_id: str | None = None
    id: str = field(default_factory=lambda: str(uuid4()))


@dataclass(frozen=True, slots=True, kw_only=True)
class DraftVariableFileWriteCommand:
    """Offloaded-file metadata to save atomically with variable references or retain for cleanup.

    length=None means the original value is neither an array nor an object.
    """

    id: str
    tenant_id: str
    app_id: str
    user_id: str
    upload_file_id: str
    size: int
    length: int | None
    value_type: SegmentType
