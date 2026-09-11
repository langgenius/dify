from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel


class FileKind(StrEnum):
    UPLOAD = "upload"
    TOOL = "tool"


class FileGrantScope(StrEnum):
    UPLOAD = "upload"
    RESOLVE = "resolve"
    PRODUCE = "produce"


class FileGrantClaims(BaseModel):
    sub: str
    tenant_id: str
    app_id: str
    scopes: list[FileGrantScope]
    exp: int


class FileContentClaims(BaseModel):
    kind: FileKind
    file_id: str
    exp: int


@dataclass(frozen=True, slots=True)
class FileGrantContext:
    tenant_id: str
    app_id: str
    end_user_id: str


@dataclass(frozen=True, slots=True)
class FileRef:
    id: str
    kind: FileKind


@dataclass(frozen=True, slots=True)
class ResolvedFile:
    id: str
    kind: FileKind
    name: str
    size: int
    extension: str
    mime_type: str | None


@dataclass(frozen=True, slots=True)
class ResolvedFileAccess:
    file: ResolvedFile
    external_url: str
    internal_url: str


@dataclass(frozen=True, slots=True)
class FileContentRecord:
    name: str
    size: int
    mime_type: str | None
    storage_key: str


@dataclass(frozen=True, slots=True)
class FileContent:
    name: str
    size: int
    mime_type: str | None
    stream: Iterable[bytes]


@dataclass(frozen=True, slots=True)
class StoredUpload:
    id: str
    name: str
    size: int
    extension: str | None
    mime_type: str | None
    created_by: str | None
    created_at: datetime | None
    tenant_id: str | None
    source_url: str


@dataclass(frozen=True, slots=True)
class StoredProducedFile:
    id: str
    name: str
    size: int
    mime_type: str | None


@dataclass(frozen=True, slots=True)
class RemoteFile:
    filename: str
    mimetype: str
    content: bytes


@dataclass(frozen=True, slots=True)
class FileGrantLimits:
    file_size_limit: int
    image_file_size_limit: int
    audio_file_size_limit: int
    video_file_size_limit: int
    workflow_file_upload_limit: int
    batch_count_limit: int


@dataclass(frozen=True, slots=True)
class FileGrantMintRequest:
    tenant_id: str
    app_id: str
    subject: str
    is_anonymous: bool
    scopes: tuple[FileGrantScope, ...]
    ttl_seconds: int
    file_refs: tuple[FileRef, ...]
    optional_file_refs: tuple[FileRef, ...]
    run_deadline: int | None


@dataclass(frozen=True, slots=True)
class FileGrantMintResult:
    grant: str
    expires_at: int
    limits: FileGrantLimits
    files: tuple[ResolvedFile, ...]
    optional_files: tuple[ResolvedFileAccess | None, ...]
