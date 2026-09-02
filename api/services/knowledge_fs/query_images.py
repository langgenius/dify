"""Validation and bounded loading for KnowledgeFS query-image UploadFile references."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Literal

from configs import dify_config
from core.app.file_access import DatabaseFileAccessController
from core.db.session_factory import session_factory
from core.workflow.file_reference import parse_file_reference
from extensions.ext_storage import storage
from graphon.file import File, FileTransferMethod, FileType
from libs.datetime_utils import naive_utc_now
from models import ToolFile
from models.enums import CreatorUserRole
from models.model import UploadFile
from services.file_service import FileService

QUERY_IMAGE_MAX_COUNT = 4
QUERY_IMAGE_MAX_BYTES = 10 * 1024 * 1024
QUERY_IMAGE_MAX_TOTAL_BYTES = 32 * 1024 * 1024
QUERY_IMAGE_MIME_TYPES = frozenset({"image/gif", "image/jpeg", "image/png", "image/webp"})
WORKFLOW_QUERY_IMAGE_GRANT_TTL_SECONDS = 5 * 60
_WORKFLOW_QUERY_IMAGE_GRANT_DOMAIN = b"knowledge-fs-workflow-query-image-v1"
_WORKFLOW_QUERY_IMAGE_GRANT_VERSION = 1


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


@dataclass(frozen=True)
class KnowledgeFSWorkflowQueryImageReference:
    """One workflow-authorized Dify file reference safe to forward through KnowledgeFS."""

    upload_file_id: str
    access_grant: str = field(repr=False)
    byte_size: int
    mime_type: str


@dataclass(frozen=True)
class _QueryImageStorageRecord:
    key: str
    mime_type: str
    size: int


@dataclass(frozen=True)
class _WorkflowQueryImageGrant:
    expires_at: int
    file_id: str
    file_kind: Literal["tool_file", "upload_file"]
    subject_id: str
    tenant_id: str


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


def issue_workflow_query_image_reference(
    *,
    app_id: str,
    file: File,
    tenant_id: str,
    now: int | None = None,
) -> KnowledgeFSWorkflowQueryImageReference:
    """Authorize one graph file before an app-scoped KnowledgeFS request.

    The current workflow file-access scope remains authoritative.  The short-lived grant lets the
    inner storage endpoint prove that this exact file was selected by an authorized workflow run;
    KnowledgeFS never receives Dify storage keys or a tenant-wide file capability.
    """

    normalized_app_id = app_id.strip()
    normalized_tenant_id = tenant_id.strip()
    if not normalized_app_id or not normalized_tenant_id:
        raise KnowledgeFSQueryImageError("QUERY_IMAGE_CONTEXT_INVALID", "Workflow query image context is invalid")
    if file.type is not FileType.IMAGE:
        raise KnowledgeFSQueryImageError("QUERY_IMAGE_MIME_UNSUPPORTED", "Workflow query file must be an image")
    reference = parse_file_reference(file.reference)
    if reference is None:
        raise KnowledgeFSQueryImageError(
            "QUERY_IMAGE_REFERENCE_UNSUPPORTED",
            "Workflow query image must be backed by Dify-managed storage",
        )

    controller = DatabaseFileAccessController()
    file_kind: Literal["tool_file", "upload_file"]
    with session_factory.create_session() as session:
        if file.transfer_method is FileTransferMethod.TOOL_FILE:
            stored = controller.get_tool_file(session=session, file_id=reference.record_id)
            file_kind = "tool_file"
            if stored is None or stored.tenant_id != normalized_tenant_id:
                raise KnowledgeFSQueryImageError("QUERY_IMAGE_NOT_FOUND", "Query image was not found")
            mime_type = _validate_image_metadata(mime_type=stored.mimetype, size=stored.size)
            byte_size = stored.size
        elif file.transfer_method in {
            FileTransferMethod.LOCAL_FILE,
            FileTransferMethod.DATASOURCE_FILE,
            FileTransferMethod.REMOTE_URL,
        }:
            stored = controller.get_upload_file(session=session, file_id=reference.record_id)
            file_kind = "upload_file"
            if stored is None or stored.tenant_id != normalized_tenant_id:
                raise KnowledgeFSQueryImageError("QUERY_IMAGE_NOT_FOUND", "Query image was not found")
            mime_type = _validate_image_metadata(mime_type=stored.mime_type, size=stored.size)
            byte_size = stored.size
        else:  # pragma: no cover - FileTransferMethod is exhaustive, retained for forward compatibility.
            raise KnowledgeFSQueryImageError(
                "QUERY_IMAGE_REFERENCE_UNSUPPORTED",
                "Workflow query image transfer method is not supported",
            )

    issued_at = int(time.time()) if now is None else now
    grant = _WorkflowQueryImageGrant(
        expires_at=issued_at + WORKFLOW_QUERY_IMAGE_GRANT_TTL_SECONDS,
        file_id=reference.record_id,
        file_kind=file_kind,
        subject_id=f"dify-app:{normalized_app_id}",
        tenant_id=normalized_tenant_id,
    )
    return KnowledgeFSWorkflowQueryImageReference(
        access_grant=_encode_workflow_query_image_grant(grant),
        # The existing wire name remains uploadFileId for compatibility.  The signed grant carries
        # the authoritative backing kind, so tool files cannot be confused with UploadFile rows.
        upload_file_id=reference.record_id,
        byte_size=byte_size,
        mime_type=mime_type,
    )


def load_query_image(
    *,
    tenant_id: str,
    upload_file_id: str,
    account_id: str | None = None,
    access_grant: str | None = None,
    subject_id: str | None = None,
) -> KnowledgeFSResolvedQueryImage:
    """Load and sniff one actor-owned or workflow-granted image from configured storage."""

    normalized_ids = _validate_reference_ids([upload_file_id])
    if access_grant:
        grant = _decode_workflow_query_image_grant(
            access_grant,
            expected_file_id=upload_file_id,
            expected_subject_id=subject_id,
            expected_tenant_id=tenant_id,
        )
        record = _load_granted_query_image_record(grant)
    else:
        if not account_id:
            raise KnowledgeFSQueryImageError("QUERY_IMAGE_SUBJECT_INVALID", "Query image subject is invalid")
        with session_factory.create_session() as session:
            upload_file = FileService.get_upload_files_by_ids(tenant_id, normalized_ids, session=session).get(
                upload_file_id
            )
            if upload_file is None:
                raise KnowledgeFSQueryImageError("QUERY_IMAGE_NOT_FOUND", "Query image was not found")
            _assert_actor_owned(upload_file, account_id=account_id)
            record = _QueryImageStorageRecord(
                key=upload_file.key,
                mime_type=_validate_metadata(upload_file),
                size=upload_file.size,
            )

    body = _load_bounded_body(object_key=record.key, expected_size=record.size)
    if not body:
        raise KnowledgeFSQueryImageError("QUERY_IMAGE_EMPTY", "Query image is empty")
    detected_mime_type = _detect_image_mime_type(body)
    if detected_mime_type != record.mime_type:
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
    return _validate_image_metadata(mime_type=upload_file.mime_type, size=upload_file.size)


def _validate_image_metadata(*, mime_type: str | None, size: int) -> str:
    mime_type = (mime_type or "").split(";", 1)[0].strip().lower()
    if mime_type not in QUERY_IMAGE_MIME_TYPES:
        raise KnowledgeFSQueryImageError("QUERY_IMAGE_MIME_UNSUPPORTED", "Query image MIME type is not supported")
    if size < 1:
        raise KnowledgeFSQueryImageError("QUERY_IMAGE_EMPTY", "Query image is empty")
    if size > QUERY_IMAGE_MAX_BYTES:
        raise KnowledgeFSQueryImageError(
            "QUERY_IMAGE_TOO_LARGE", f"Query image exceeds max bytes {QUERY_IMAGE_MAX_BYTES}"
        )
    return mime_type


def _load_granted_query_image_record(grant: _WorkflowQueryImageGrant) -> _QueryImageStorageRecord:
    with session_factory.create_session() as session:
        if grant.file_kind == "tool_file":
            stored = session.get(ToolFile, grant.file_id)
            if stored is None or stored.tenant_id != grant.tenant_id:
                raise KnowledgeFSQueryImageError("QUERY_IMAGE_NOT_FOUND", "Query image was not found")
            return _QueryImageStorageRecord(
                key=stored.file_key,
                mime_type=_validate_image_metadata(mime_type=stored.mimetype, size=stored.size),
                size=stored.size,
            )
        stored = FileService.get_upload_files_by_ids(
            grant.tenant_id,
            [grant.file_id],
            session=session,
        ).get(grant.file_id)
        if stored is None:
            raise KnowledgeFSQueryImageError("QUERY_IMAGE_NOT_FOUND", "Query image was not found")
        return _QueryImageStorageRecord(
            key=stored.key,
            mime_type=_validate_metadata(stored),
            size=stored.size,
        )


def _encode_workflow_query_image_grant(grant: _WorkflowQueryImageGrant) -> str:
    payload = json.dumps(
        {
            "exp": grant.expires_at,
            "fileId": grant.file_id,
            "fileKind": grant.file_kind,
            "subjectId": grant.subject_id,
            "tenantId": grant.tenant_id,
            "v": _WORKFLOW_QUERY_IMAGE_GRANT_VERSION,
        },
        separators=(",", ":"),
        sort_keys=True,
    ).encode()
    encoded_payload = _base64url_encode(payload)
    signature = hmac.new(
        dify_config.SECRET_KEY.encode(),
        _WORKFLOW_QUERY_IMAGE_GRANT_DOMAIN + b"." + encoded_payload.encode(),
        hashlib.sha256,
    ).digest()
    return f"{encoded_payload}.{_base64url_encode(signature)}"


def _decode_workflow_query_image_grant(
    value: str,
    *,
    expected_file_id: str,
    expected_subject_id: str | None,
    expected_tenant_id: str,
) -> _WorkflowQueryImageGrant:
    if not expected_subject_id or len(value) > 2_048:
        raise KnowledgeFSQueryImageError("QUERY_IMAGE_GRANT_INVALID", "Workflow query image grant is invalid")
    try:
        encoded_payload, encoded_signature = value.split(".", 1)
        payload = _base64url_decode(encoded_payload)
        signature = _base64url_decode(encoded_signature)
        expected_signature = hmac.new(
            dify_config.SECRET_KEY.encode(),
            _WORKFLOW_QUERY_IMAGE_GRANT_DOMAIN + b"." + encoded_payload.encode(),
            hashlib.sha256,
        ).digest()
        if not hmac.compare_digest(signature, expected_signature):
            raise ValueError("signature mismatch")
        raw = json.loads(payload)
        if not isinstance(raw, dict):
            raise ValueError("payload must be an object")
        grant = _WorkflowQueryImageGrant(
            expires_at=int(raw["exp"]),
            file_id=str(raw["fileId"]),
            file_kind=raw["fileKind"],
            subject_id=str(raw["subjectId"]),
            tenant_id=str(raw["tenantId"]),
        )
        if raw.get("v") != _WORKFLOW_QUERY_IMAGE_GRANT_VERSION or grant.file_kind not in {
            "tool_file",
            "upload_file",
        }:
            raise ValueError("unsupported grant")
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise KnowledgeFSQueryImageError("QUERY_IMAGE_GRANT_INVALID", "Workflow query image grant is invalid") from exc
    if grant.expires_at <= int(time.time()):
        raise KnowledgeFSQueryImageError("QUERY_IMAGE_GRANT_EXPIRED", "Workflow query image grant has expired")
    if (
        grant.file_id != expected_file_id
        or grant.subject_id != expected_subject_id
        or grant.tenant_id != expected_tenant_id
    ):
        raise KnowledgeFSQueryImageError("QUERY_IMAGE_GRANT_INVALID", "Workflow query image grant is invalid")
    return grant


def _base64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def _base64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


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
