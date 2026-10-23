"""Workspace staging and single-claim admission for KnowledgeFS documents."""

from __future__ import annotations

from base64 import b64encode
from datetime import timedelta
from hashlib import sha256
from urllib.parse import quote

import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_storage import storage
from libs.datetime_utils import naive_utc_now
from models.knowledge_fs import (
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpaceState,
    KnowledgeFSStagedUpload,
    KnowledgeFSStagedUploadStatus,
)
from models.model import Account, UploadFile
from services.errors.file import BlockedFileExtensionError, FileTooLargeError, UnsupportedFileTypeError
from services.file_service import FileService
from services.knowledge_fs.data_facade import KnowledgeFSDataFacade
from services.knowledge_fs.object_storage import KnowledgeFSObjectStorageService
from services.knowledge_fs.product_dto import (
    KnowledgeFSDocumentStagedUploadAcceptedResponse,
    KnowledgeFSDocumentStagedUploadPayload,
    KnowledgeFSStagedUploadResponse,
    KnowledgeFSUploadSessionCompletePayload,
    KnowledgeFSUploadSessionCreatePayload,
)

STAGED_UPLOAD_TTL = timedelta(hours=24)
_KNOWLEDGE_FS_DOCUMENT_MIME_TYPES = {
    "csv": "text/csv",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "eml": "message/rfc822",
    "epub": "application/epub+zip",
    "htm": "text/html",
    "html": "text/html",
    "json": "application/json",
    "jsonl": "application/x-ndjson",
    "markdown": "text/markdown",
    "md": "text/markdown",
    "mdx": "text/mdx",
    "msg": "application/vnd.ms-outlook",
    "odt": "application/vnd.oasis.opendocument.text",
    "pdf": "application/pdf",
    "ppt": "application/vnd.ms-powerpoint",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "properties": "text/x-java-properties",
    "rtf": "application/rtf",
    "text": "text/plain",
    "txt": "text/plain",
    "vtt": "text/vtt",
    "xls": "application/vnd.ms-excel",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "xml": "application/xml",
}


class KnowledgeFSStagedUploadError(ValueError):
    """Base error safe for conversion at the Console boundary."""


class KnowledgeFSStagedUploadNotFoundError(KnowledgeFSStagedUploadError):
    pass


class KnowledgeFSStagedUploadConflictError(KnowledgeFSStagedUploadError):
    pass


class KnowledgeFSStagedUploadInvalidError(KnowledgeFSStagedUploadError):
    pass


class KnowledgeFSStagedUploadTooLargeError(KnowledgeFSStagedUploadInvalidError):
    pass


class KnowledgeFSStagedUploadService:
    def __init__(
        self,
        session_maker: sessionmaker[Session],
        *,
        facade: KnowledgeFSDataFacade,
        object_storage: KnowledgeFSObjectStorageService | None = None,
    ) -> None:
        self._session_maker = session_maker
        self._facade = facade
        self._object_storage = object_storage or KnowledgeFSObjectStorageService()

    def stage(
        self,
        *,
        tenant_id: str,
        account: Account,
        file_name: str,
        content_type: str,
        body: bytes,
        file_size_limit_mb: int,
    ) -> KnowledgeFSStagedUploadResponse:
        if not body:
            raise KnowledgeFSStagedUploadInvalidError("KnowledgeFS staged upload is empty")
        _, separator, extension = file_name.strip().lower().rpartition(".")
        if not separator or extension not in _KNOWLEDGE_FS_DOCUMENT_MIME_TYPES:
            raise KnowledgeFSStagedUploadInvalidError("KnowledgeFS staged upload is invalid")
        # Browser/OS MIME declarations are inconsistent and can route a binary document through a
        # text parser. The admitted extension is the product contract, so persist its canonical MIME.
        normalized_content_type = _KNOWLEDGE_FS_DOCUMENT_MIME_TYPES[extension]
        checksum = b64encode(sha256(body).digest()).decode()
        try:
            upload_file = FileService(self._session_maker).upload_file(
                filename=file_name,
                content=body,
                mimetype=normalized_content_type,
                user=account,
                tenant_id=tenant_id,
                source="knowledge_fs",
                default_file_size_limit=file_size_limit_mb,
            )
        except FileTooLargeError as exc:
            raise KnowledgeFSStagedUploadTooLargeError("KnowledgeFS staged upload is too large") from exc
        except (BlockedFileExtensionError, UnsupportedFileTypeError, ValueError, FileNotFoundError) as exc:
            raise KnowledgeFSStagedUploadInvalidError("KnowledgeFS staged upload is invalid") from exc

        staged = KnowledgeFSStagedUpload(
            tenant_id=tenant_id,
            account_id=account.id,
            upload_file_id=upload_file.id,
            file_name=upload_file.name,
            content_type=upload_file.mime_type or normalized_content_type,
            size_bytes=upload_file.size,
            checksum_sha256_base64=checksum,
            expires_at=naive_utc_now() + STAGED_UPLOAD_TTL,
        )
        try:
            with self._session_maker(expire_on_commit=False) as session:
                session.add(staged)
                session.commit()
        except Exception:
            storage.delete(upload_file.key)
            with self._session_maker() as session:
                persisted = session.get(UploadFile, upload_file.id)
                if persisted is not None:
                    session.delete(persisted)
                    session.commit()
            raise
        return _staged_response(staged)

    def claim(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        payload: KnowledgeFSDocumentStagedUploadPayload,
    ) -> KnowledgeFSDocumentStagedUploadAcceptedResponse:
        staged, upload_file = self._begin_claim(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            upload_id=payload.upload_id,
        )
        if staged.status is KnowledgeFSStagedUploadStatus.CLAIMED:
            return _claim_response(staged)

        try:
            upload_session_id = staged.upload_session_id
            knowledge_space_id = staged.knowledge_space_id
            if upload_session_id is None:
                created = self._facade.create_upload_session(
                    tenant_id=tenant_id,
                    account_id=account_id,
                    control_space_id=control_space_id,
                    payload=KnowledgeFSUploadSessionCreatePayload(
                        checksumSha256Base64=staged.checksum_sha256_base64,
                        contentType=staged.content_type,
                        expectedSizeBytes=staged.size_bytes,
                        fileName=staged.file_name,
                    ),
                    idempotency_key=f"staged-upload:{staged.id}",
                )
                if created.session.mode == "multipart":
                    raise KnowledgeFSStagedUploadInvalidError(
                        "KnowledgeFS staged uploads do not use multipart object credentials"
                    )
                upload_session_id = created.session.id
                knowledge_space_id = self._knowledge_space_id(
                    tenant_id=tenant_id,
                    control_space_id=control_space_id,
                )
                self._record_upload_session(
                    tenant_id=tenant_id,
                    account_id=account_id,
                    upload_id=staged.id,
                    control_space_id=control_space_id,
                    knowledge_space_id=knowledge_space_id,
                    upload_session_id=upload_session_id,
                )
            if knowledge_space_id is None or upload_session_id is None:
                raise KnowledgeFSStagedUploadConflictError("KnowledgeFS staged upload session is incomplete")

            object_key = _upload_object_key(tenant_id, knowledge_space_id, upload_session_id)
            self._object_storage.adopt_upload_file(
                key=object_key,
                source_path=upload_file.key,
                tenant_id=tenant_id,
                size_bytes=staged.size_bytes,
                checksum_sha256_base64=staged.checksum_sha256_base64,
                content_type=staged.content_type,
                metadata={
                    "checksum_sha256_base64": staged.checksum_sha256_base64,
                    "knowledge_space_id": knowledge_space_id,
                    "tenant_id": tenant_id,
                    "upload_session_id": upload_session_id,
                },
            )
            completed = self._facade.complete_upload_session(
                tenant_id=tenant_id,
                account_id=account_id,
                control_space_id=control_space_id,
                upload_session_id=upload_session_id,
                payload=KnowledgeFSUploadSessionCompletePayload(),
            )
            document_asset_id = completed.session.document_asset_id
            compilation_job_id = completed.session.compilation_job_id
            if not document_asset_id or not compilation_job_id:
                raise KnowledgeFSStagedUploadConflictError("KnowledgeFS upload completion is incomplete")
            return self._finish_claim(
                tenant_id=tenant_id,
                account_id=account_id,
                upload_id=staged.id,
                document_asset_id=document_asset_id,
                compilation_job_id=compilation_job_id,
            )
        except Exception as exc:
            self._mark_failed(
                tenant_id=tenant_id,
                account_id=account_id,
                upload_id=staged.id,
                error_code=type(exc).__name__,
            )
            raise

    def abort(self, *, tenant_id: str, account_id: str, upload_id: str) -> None:
        with self._session_maker(expire_on_commit=False) as session:
            staged = session.scalar(
                _owned_upload_statement(
                    tenant_id=tenant_id,
                    account_id=account_id,
                    upload_id=upload_id,
                ).with_for_update()
            )
            if staged is None:
                raise KnowledgeFSStagedUploadNotFoundError("KnowledgeFS staged upload was not found")
            if staged.status is KnowledgeFSStagedUploadStatus.CLAIMED:
                raise KnowledgeFSStagedUploadConflictError("Claimed KnowledgeFS uploads must be deleted as documents")
            if staged.status in {
                KnowledgeFSStagedUploadStatus.ABORTED,
                KnowledgeFSStagedUploadStatus.EXPIRED,
            }:
                return
            if staged.status is KnowledgeFSStagedUploadStatus.CLAIMING:
                raise KnowledgeFSStagedUploadConflictError("KnowledgeFS staged upload is being claimed")
            upload_file = session.get(UploadFile, staged.upload_file_id)
            if staged.upload_session_id is not None:
                raise KnowledgeFSStagedUploadConflictError(
                    "Prepared KnowledgeFS staged upload can only be resolved by retrying its claim"
                )
            if upload_file is not None:
                storage.delete(upload_file.key)
            staged.status = KnowledgeFSStagedUploadStatus.ABORTED
            staged.row_version += 1
            session.commit()

    def cleanup_expired(self, *, limit: int = 100) -> int:
        """Delete bounded, never-prepared uploads; KFS owns cleanup after session creation."""
        now = naive_utc_now()
        cleaned = 0
        with self._session_maker() as session:
            staged_uploads = list(
                session.scalars(
                    sa.select(KnowledgeFSStagedUpload)
                    .where(
                        KnowledgeFSStagedUpload.status.in_(
                            [KnowledgeFSStagedUploadStatus.UPLOADED, KnowledgeFSStagedUploadStatus.FAILED]
                        ),
                        KnowledgeFSStagedUpload.expires_at <= now,
                        KnowledgeFSStagedUpload.upload_session_id.is_(None),
                    )
                    .order_by(KnowledgeFSStagedUpload.expires_at, KnowledgeFSStagedUpload.id)
                    .limit(limit)
                    .with_for_update(skip_locked=True)
                )
            )
            for staged in staged_uploads:
                upload_file = session.get(UploadFile, staged.upload_file_id)
                if upload_file is not None:
                    storage.delete(upload_file.key)
                staged.status = KnowledgeFSStagedUploadStatus.EXPIRED
                staged.row_version += 1
                cleaned += 1
            session.commit()
        return cleaned

    def _begin_claim(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        upload_id: str,
    ) -> tuple[KnowledgeFSStagedUpload, UploadFile]:
        with self._session_maker(expire_on_commit=False) as session:
            staged = session.scalar(
                _owned_upload_statement(
                    tenant_id=tenant_id,
                    account_id=account_id,
                    upload_id=upload_id,
                ).with_for_update()
            )
            if staged is None:
                raise KnowledgeFSStagedUploadNotFoundError("KnowledgeFS staged upload was not found")
            upload_file = session.get(UploadFile, staged.upload_file_id)
            if upload_file is None or upload_file.tenant_id != tenant_id or upload_file.created_by != account_id:
                raise KnowledgeFSStagedUploadNotFoundError("KnowledgeFS staged upload file was not found")
            if staged.status is KnowledgeFSStagedUploadStatus.CLAIMED:
                if staged.control_space_id != control_space_id:
                    raise KnowledgeFSStagedUploadConflictError("KnowledgeFS staged upload belongs to another Space")
                session.expunge(upload_file)
                return staged, upload_file
            if (
                staged.status
                in {
                    KnowledgeFSStagedUploadStatus.ABORTED,
                    KnowledgeFSStagedUploadStatus.EXPIRED,
                }
                or staged.expires_at <= naive_utc_now()
            ):
                if staged.status not in {
                    KnowledgeFSStagedUploadStatus.ABORTED,
                    KnowledgeFSStagedUploadStatus.EXPIRED,
                }:
                    staged.status = KnowledgeFSStagedUploadStatus.EXPIRED
                    staged.row_version += 1
                    session.commit()
                raise KnowledgeFSStagedUploadNotFoundError("KnowledgeFS staged upload has expired")
            if staged.control_space_id is not None and staged.control_space_id != control_space_id:
                raise KnowledgeFSStagedUploadConflictError("KnowledgeFS staged upload belongs to another Space")
            if staged.status is KnowledgeFSStagedUploadStatus.CLAIMING:
                # Every downstream mutation is fenced by the staged-upload idempotency key
                # and the immutable upload-session scope. Re-entering here recovers a process
                # crash without allowing the same bytes to move to another Space.
                session.expunge(upload_file)
                return staged, upload_file
            staged.status = KnowledgeFSStagedUploadStatus.CLAIMING
            staged.control_space_id = control_space_id
            staged.last_error_code = None
            staged.row_version += 1
            session.commit()
            session.expunge(upload_file)
            return staged, upload_file

    def _knowledge_space_id(self, *, tenant_id: str, control_space_id: str) -> str:
        with self._session_maker() as session:
            control_space = session.scalar(
                sa.select(KnowledgeFSControlSpace).where(
                    KnowledgeFSControlSpace.tenant_id == tenant_id,
                    KnowledgeFSControlSpace.id == control_space_id,
                    KnowledgeFSControlSpace.state == KnowledgeFSControlSpaceState.ACTIVE,
                )
            )
            if control_space is None or control_space.knowledge_space_id is None:
                raise KnowledgeFSStagedUploadNotFoundError("KnowledgeFS Space is not active")
            return control_space.knowledge_space_id

    def _record_upload_session(
        self,
        *,
        tenant_id: str,
        account_id: str,
        upload_id: str,
        control_space_id: str,
        knowledge_space_id: str,
        upload_session_id: str,
    ) -> None:
        with self._session_maker() as session:
            staged = session.scalar(
                _owned_upload_statement(
                    tenant_id=tenant_id,
                    account_id=account_id,
                    upload_id=upload_id,
                ).with_for_update()
            )
            if staged is None or staged.status is not KnowledgeFSStagedUploadStatus.CLAIMING:
                raise KnowledgeFSStagedUploadConflictError("KnowledgeFS staged upload claim changed")
            staged.control_space_id = control_space_id
            staged.knowledge_space_id = knowledge_space_id
            staged.upload_session_id = upload_session_id
            staged.row_version += 1
            session.commit()

    def _finish_claim(
        self,
        *,
        tenant_id: str,
        account_id: str,
        upload_id: str,
        document_asset_id: str,
        compilation_job_id: str,
    ) -> KnowledgeFSDocumentStagedUploadAcceptedResponse:
        with self._session_maker(expire_on_commit=False) as session:
            staged = session.scalar(
                _owned_upload_statement(
                    tenant_id=tenant_id,
                    account_id=account_id,
                    upload_id=upload_id,
                ).with_for_update()
            )
            if staged is None:
                raise KnowledgeFSStagedUploadNotFoundError("KnowledgeFS staged upload was not found")
            if staged.status is KnowledgeFSStagedUploadStatus.CLAIMED:
                return _claim_response(staged)
            if staged.status is not KnowledgeFSStagedUploadStatus.CLAIMING:
                raise KnowledgeFSStagedUploadConflictError("KnowledgeFS staged upload claim changed")
            staged.document_asset_id = document_asset_id
            staged.compilation_job_id = compilation_job_id
            staged.claimed_at = naive_utc_now()
            staged.status = KnowledgeFSStagedUploadStatus.CLAIMED
            staged.last_error_code = None
            staged.row_version += 1
            upload_file = session.get(UploadFile, staged.upload_file_id)
            if upload_file is not None:
                upload_file.used = True
                upload_file.used_by = account_id
                upload_file.used_at = staged.claimed_at
            session.commit()
            return _claim_response(staged)

    def _mark_failed(self, *, tenant_id: str, account_id: str, upload_id: str, error_code: str) -> None:
        with self._session_maker() as session:
            staged = session.scalar(
                _owned_upload_statement(
                    tenant_id=tenant_id,
                    account_id=account_id,
                    upload_id=upload_id,
                ).with_for_update()
            )
            if staged is None or staged.status in {
                KnowledgeFSStagedUploadStatus.CLAIMED,
                KnowledgeFSStagedUploadStatus.ABORTED,
                KnowledgeFSStagedUploadStatus.EXPIRED,
            }:
                return
            staged.status = KnowledgeFSStagedUploadStatus.FAILED
            staged.last_error_code = error_code[:128]
            staged.row_version += 1
            session.commit()


def _owned_upload_statement(*, tenant_id: str, account_id: str, upload_id: str):
    return sa.select(KnowledgeFSStagedUpload).where(
        KnowledgeFSStagedUpload.id == upload_id,
        KnowledgeFSStagedUpload.tenant_id == tenant_id,
        KnowledgeFSStagedUpload.account_id == account_id,
    )


def _upload_object_key(tenant_id: str, knowledge_space_id: str, upload_session_id: str) -> str:
    return (
        f"namespaces/{quote(tenant_id, safe='')}/spaces/{quote(knowledge_space_id, safe='')}"
        f"/uploads/{quote(upload_session_id, safe='')}/source"
    )


def _staged_response(staged: KnowledgeFSStagedUpload) -> KnowledgeFSStagedUploadResponse:
    return KnowledgeFSStagedUploadResponse(
        id=staged.id,
        file_name=staged.file_name,
        content_type=staged.content_type,
        size_bytes=staged.size_bytes,
        status=staged.status.value,
        expires_at=staged.expires_at,
    )


def _claim_response(staged: KnowledgeFSStagedUpload) -> KnowledgeFSDocumentStagedUploadAcceptedResponse:
    if not staged.document_asset_id or not staged.compilation_job_id:
        raise KnowledgeFSStagedUploadConflictError("KnowledgeFS staged upload completion is incomplete")
    return KnowledgeFSDocumentStagedUploadAcceptedResponse(
        upload_id=staged.id,
        document_asset_id=staged.document_asset_id,
        compilation_job_id=staged.compilation_job_id,
    )


__all__ = [
    "STAGED_UPLOAD_TTL",
    "KnowledgeFSStagedUploadConflictError",
    "KnowledgeFSStagedUploadError",
    "KnowledgeFSStagedUploadInvalidError",
    "KnowledgeFSStagedUploadNotFoundError",
    "KnowledgeFSStagedUploadService",
    "KnowledgeFSStagedUploadTooLargeError",
]
