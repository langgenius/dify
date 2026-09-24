"""Detached upload values and the capabilities required by core callers."""

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from models.enums import CreatorUserRole


@dataclass(frozen=True, slots=True)
class FileUploadActor:
    """Creator identity, independent of the tenant receiving the upload."""

    id: str
    creator_role: CreatorUserRole


@dataclass(frozen=True, slots=True)
class FileUploadData:
    """Metadata stored with an upload, before persistence assigns its ID."""

    name: str
    size: int
    extension: str
    mime_type: str
    created_by: str
    created_at: datetime
    tenant_id: str
    source_url: str
    key: str
    storage_type: str
    created_by_role: CreatorUserRole
    hash: str | None
    used: bool
    used_by: str | None
    used_at: datetime | None


@dataclass(frozen=True, slots=True)
class FileUploadResult(FileUploadData):
    """Detached upload metadata; source_url may contain a response-only signed URL."""

    id: str


class FileUploadWriter(Protocol):
    """Upload capability required by indexing and workflow persistence."""

    def upload_file_for_actor(
        self,
        *,
        actor: FileUploadActor,
        resource_tenant_id: str,
        filename: str,
        content: bytes,
        mimetype: str,
    ) -> FileUploadResult: ...


class FileTextWriter(Protocol):
    """Store text produced by a pipeline."""

    def upload_text(self, text: str, text_name: str, user_id: str, tenant_id: str) -> FileUploadResult: ...
