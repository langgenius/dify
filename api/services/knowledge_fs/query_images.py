"""Validation and bounded loading for KnowledgeFS query-image UploadFile references."""

from __future__ import annotations

import hashlib
from collections.abc import Sequence
from dataclasses import dataclass

from core.db.session_factory import session_factory
from extensions.ext_storage import storage
from libs.datetime_utils import naive_utc_now
from models.enums import CreatorUserRole
from models.model import UploadFile
from services.file_service import FileService

QUERY_IMAGE_MAX_COUNT = 4
QUERY_IMAGE_MAX_BYTES = 10 * 1024 * 1024
QUERY_IMAGE_MAX_TOTAL_BYTES = 32 * 1024 * 1024
QUERY_IMAGE_MIME_TYPES = frozenset({"image/gif", "image/jpeg", "image/png", "image/webp"})


class KnowledgeFSQueryImageError(ValueError):
    """A safe validation error raised before query model or retrieval work starts."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class KnowledgeFSQueryImageMetadata:
    upload_file_id: str
    byte_size: int
    mime_type: str


@dataclass(frozen=True)
class KnowledgeFSResolvedQueryImage(KnowledgeFSQueryImageMetadata):
    body: bytes
    sha256: str


def validate_query_image_references(
    *,
    tenant_id: str,
    account_id: str,
    upload_file_ids: Sequence[str],
    mark_used: bool,
) -> list[KnowledgeFSQueryImageMetadata]:
    """Validate tenant/actor ownership and static bounds in one database round trip."""

    normalized_ids = _validate_reference_ids(upload_file_ids)
    if not normalized_ids:
        return []

    with session_factory.create_session() as session:
        files_by_id = FileService.get_upload_files_by_ids(tenant_id, normalized_ids, session=session)
        result: list[KnowledgeFSQueryImageMetadata] = []
        total_bytes = 0
        for upload_file_id in normalized_ids:
            upload_file = files_by_id.get(upload_file_id)
            if upload_file is None:
                raise KnowledgeFSQueryImageError("QUERY_IMAGE_NOT_FOUND", "Query image was not found")
            _assert_actor_owned(upload_file, account_id=account_id)
            mime_type = _validate_metadata(upload_file)
            total_bytes += upload_file.size
            result.append(
                KnowledgeFSQueryImageMetadata(
                    upload_file_id=upload_file_id,
                    byte_size=upload_file.size,
                    mime_type=mime_type,
                )
            )
            if mark_used:
                upload_file.used = True
                upload_file.used_by = account_id
                upload_file.used_at = naive_utc_now()

        if total_bytes > QUERY_IMAGE_MAX_TOTAL_BYTES:
            raise KnowledgeFSQueryImageError(
                "QUERY_IMAGE_TOTAL_TOO_LARGE",
                f"Query images exceed aggregate max bytes {QUERY_IMAGE_MAX_TOTAL_BYTES}",
            )
        if mark_used:
            session.commit()
        return result


def load_query_image(*, tenant_id: str, account_id: str, upload_file_id: str) -> KnowledgeFSResolvedQueryImage:
    """Load and sniff one validated image from Dify's configured object storage."""

    normalized_ids = _validate_reference_ids([upload_file_id])
    with session_factory.create_session() as session:
        upload_file = FileService.get_upload_files_by_ids(tenant_id, normalized_ids, session=session).get(
            upload_file_id
        )
        if upload_file is None:
            raise KnowledgeFSQueryImageError("QUERY_IMAGE_NOT_FOUND", "Query image was not found")
        _assert_actor_owned(upload_file, account_id=account_id)
        declared_mime_type = _validate_metadata(upload_file)
        object_key = upload_file.key
        declared_size = upload_file.size

    body = _load_bounded_body(object_key=object_key, expected_size=declared_size)
    if not body:
        raise KnowledgeFSQueryImageError("QUERY_IMAGE_EMPTY", "Query image is empty")
    detected_mime_type = _detect_image_mime_type(body)
    if detected_mime_type != declared_mime_type:
        raise KnowledgeFSQueryImageError(
            "QUERY_IMAGE_MIME_MISMATCH", "Query image content does not match its MIME type"
        )

    return KnowledgeFSResolvedQueryImage(
        upload_file_id=upload_file_id,
        byte_size=len(body),
        mime_type=detected_mime_type,
        body=body,
        sha256=hashlib.sha256(body).hexdigest(),
    )


def _load_bounded_body(*, object_key: str, expected_size: int) -> bytes:
    chunks: list[bytes] = []
    total_bytes = 0
    stream = storage.load(object_key, stream=True)
    try:
        for chunk in stream:
            if not isinstance(chunk, (bytes, bytearray, memoryview)):
                raise KnowledgeFSQueryImageError("QUERY_IMAGE_SIZE_INVALID", "Query image stream is invalid")
            body_chunk = bytes(chunk)
            total_bytes += len(body_chunk)
            if total_bytes > QUERY_IMAGE_MAX_BYTES or total_bytes > expected_size:
                raise KnowledgeFSQueryImageError(
                    "QUERY_IMAGE_SIZE_INVALID", "Query image size does not match its metadata"
                )
            chunks.append(body_chunk)
    finally:
        close = getattr(stream, "close", None)
        if callable(close):
            close()

    if total_bytes != expected_size:
        raise KnowledgeFSQueryImageError("QUERY_IMAGE_SIZE_INVALID", "Query image size does not match its metadata")
    return b"".join(chunks)


def _validate_reference_ids(upload_file_ids: Sequence[str]) -> list[str]:
    normalized = [str(value).strip() for value in upload_file_ids]
    if len(normalized) > QUERY_IMAGE_MAX_COUNT:
        raise KnowledgeFSQueryImageError(
            "QUERY_IMAGE_COUNT_EXCEEDED", f"queryImages exceeds max count {QUERY_IMAGE_MAX_COUNT}"
        )
    if any(not value for value in normalized):
        raise KnowledgeFSQueryImageError("QUERY_IMAGE_REFERENCE_INVALID", "Query image reference is invalid")
    if len(set(normalized)) != len(normalized):
        raise KnowledgeFSQueryImageError(
            "QUERY_IMAGE_REFERENCE_DUPLICATE", "queryImages must not contain duplicate uploadFileId values"
        )
    return normalized


def _assert_actor_owned(upload_file: UploadFile, *, account_id: str) -> None:
    if upload_file.created_by_role != CreatorUserRole.ACCOUNT or upload_file.created_by != account_id:
        # Deliberately use the same not-found result as an unknown id to avoid disclosing foreign files.
        raise KnowledgeFSQueryImageError("QUERY_IMAGE_NOT_FOUND", "Query image was not found")


def _validate_metadata(upload_file: UploadFile) -> str:
    mime_type = (upload_file.mime_type or "").split(";", 1)[0].strip().lower()
    if mime_type not in QUERY_IMAGE_MIME_TYPES:
        raise KnowledgeFSQueryImageError("QUERY_IMAGE_MIME_UNSUPPORTED", "Query image MIME type is not supported")
    if upload_file.size < 1:
        raise KnowledgeFSQueryImageError("QUERY_IMAGE_EMPTY", "Query image is empty")
    if upload_file.size > QUERY_IMAGE_MAX_BYTES:
        raise KnowledgeFSQueryImageError(
            "QUERY_IMAGE_TOO_LARGE", f"Query image exceeds max bytes {QUERY_IMAGE_MAX_BYTES}"
        )
    return mime_type


def _detect_image_mime_type(body: bytes) -> str:
    if body.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if body.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if body.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if len(body) >= 12 and body.startswith(b"RIFF") and body[8:12] == b"WEBP":
        return "image/webp"
    raise KnowledgeFSQueryImageError("QUERY_IMAGE_CONTENT_UNSUPPORTED", "Query image content is not supported")
