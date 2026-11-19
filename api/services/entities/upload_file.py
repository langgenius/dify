"""Cross-domain upload-file identities and detached persistence records."""

from dataclasses import dataclass
from datetime import datetime

from enums.creator import CreatorUserRole


@dataclass(frozen=True, slots=True)
class FileUploadActor:
    """Creator identity, independent of the tenant receiving the upload."""

    id: str
    creator_role: CreatorUserRole


@dataclass(frozen=True, slots=True)
class UploadFileRecord:
    """Detached UploadFile values shared by services and persistence adapters."""

    id: str
    tenant_id: str
    storage_type: str
    key: str
    name: str
    size: int
    extension: str
    mime_type: str | None
    created_by_role: CreatorUserRole
    created_by: str
    created_at: datetime
    hash: str | None
    source_url: str
    used: bool = False
    used_by: str | None = None
    used_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class CreatedUploadArtifact:
    """A blob created while an extractor constructs its UploadFile record."""

    id: str
    key: str


@dataclass(frozen=True, slots=True)
class UploadFileReferenceCandidate:
    """Stable file identity passed to owner-domain liveness queries."""

    id: str
    key: str
