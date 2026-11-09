from __future__ import annotations

import base64
import hashlib
from collections.abc import Callable, Sequence
from typing import IO, Protocol

from services.entities.file_grant_entities import (
    FileContent,
    FileContentClaims,
    FileContentRecord,
    FileGrantClaims,
    FileGrantContext,
    FileGrantLimits,
    FileGrantMintRequest,
    FileGrantMintResult,
    FileGrantScope,
    FileKind,
    FileRef,
    RemoteFile,
    ResolvedFile,
    ResolvedFileAccess,
    StoredProducedFile,
    StoredUpload,
)
from services.errors.file_grant import (
    AppNotFoundError,
    EndUserNotFoundError,
    GrantedFileNotFoundError,
    GrantTtlTooLongError,
    InvalidFileGrantError,
    InvalidGrantRequestError,
    InvalidSubjectError,
    RemoteFileUnavailableError,
    TooManyFileRefsError,
)

MAX_SESSION_GRANT_TTL_SECONDS = 7200
MAX_WORKFLOW_EXECUTION_SECONDS = 24 * 60 * 60
RUN_GRANT_EXPIRY_GRACE_SECONDS = 5 * 60
MAX_RUN_GRANT_TTL_SECONDS = MAX_WORKFLOW_EXECUTION_SECONDS + RUN_GRANT_EXPIRY_GRACE_SECONDS
MAX_FILE_GRANT_REFS = 100


class FileGrantRepository(Protocol):
    def get_or_create_subject(
        self,
        *,
        tenant_id: str,
        app_id: str,
        session_id: str,
        external_user_id: str,
        is_anonymous: bool,
    ) -> str | None: ...

    def subject_exists(self, context: FileGrantContext) -> bool: ...

    def resolve_owned_files(
        self,
        *,
        context: FileGrantContext,
        refs: Sequence[FileRef],
    ) -> list[ResolvedFile | None]: ...

    def get_content_record(self, *, file_id: str, kind: FileKind) -> FileContentRecord | None: ...


class FileGrantFiles(Protocol):
    def store_upload_stream(
        self,
        *,
        context: FileGrantContext,
        filename: str,
        stream: IO[bytes],
        mimetype: str,
    ) -> StoredUpload: ...

    def store_upload(
        self,
        *,
        context: FileGrantContext,
        filename: str,
        content: bytes,
        mimetype: str,
        source_url: str = "",
    ) -> StoredUpload: ...

    def store_produced(
        self,
        *,
        context: FileGrantContext,
        filename: str | None,
        stream: IO[bytes],
        mimetype: str,
    ) -> StoredProducedFile: ...

    def open_content(self, record: FileContentRecord) -> FileContent: ...


class FileGrantTokens(Protocol):
    def issue_grant(
        self,
        *,
        context: FileGrantContext,
        scopes: Sequence[FileGrantScope],
        ttl_seconds: int,
    ) -> tuple[str, int]: ...

    def decode_grant(self, token: str) -> FileGrantClaims | None: ...

    def issue_content_urls(self, *, file_id: str, kind: FileKind) -> tuple[str, str]: ...

    def decode_content_token(self, token: str) -> FileContentClaims | None: ...


class FileGrantRemoteFiles(Protocol):
    def fetch(self, url: str) -> RemoteFile | None: ...


class FileGrantService:
    def __init__(
        self,
        *,
        repository: FileGrantRepository,
        files: FileGrantFiles,
        tokens: FileGrantTokens,
        remote_files: FileGrantRemoteFiles,
        limits: FileGrantLimits,
        now: Callable[[], int],
    ) -> None:
        self._repository = repository
        self._files = files
        self._tokens = tokens
        self._remote_files = remote_files
        self._limits = limits
        self._now = now

    @staticmethod
    def session_id_for_subject(subject: str) -> str:
        digest = hashlib.sha256(subject.encode()).digest()
        return base64.urlsafe_b64encode(digest).decode().rstrip("=")

    def mint(self, request: FileGrantMintRequest) -> FileGrantMintResult:
        self._validate_subject(request.subject)
        self._validate_ref_count((*request.file_refs, *request.optional_file_refs))
        ttl_seconds = self._effective_ttl_seconds(request)

        end_user_id = self._repository.get_or_create_subject(
            tenant_id=request.tenant_id,
            app_id=request.app_id,
            session_id=self.session_id_for_subject(request.subject),
            external_user_id=request.subject[:255],
            is_anonymous=request.is_anonymous,
        )
        if end_user_id is None:
            raise AppNotFoundError(request.app_id)

        context = FileGrantContext(request.tenant_id, request.app_id, end_user_id)
        strict_file_count = len(request.file_refs)
        resolved_files = self._repository.resolve_owned_files(
            context=context,
            refs=(*request.file_refs, *request.optional_file_refs),
        )
        strict_files = resolved_files[:strict_file_count]
        if any(file is None for file in strict_files):
            raise GrantedFileNotFoundError()
        optional_files = resolved_files[strict_file_count:]
        grant, expires_at = self._tokens.issue_grant(
            context=context,
            scopes=request.scopes,
            ttl_seconds=ttl_seconds,
        )
        return FileGrantMintResult(
            grant=grant,
            expires_at=expires_at,
            limits=self._limits,
            files=tuple(file for file in strict_files if file is not None),
            optional_files=tuple(self._with_access(file) if file is not None else None for file in optional_files),
        )

    def decode_grant(self, token: str) -> FileGrantClaims | None:
        return self._tokens.decode_grant(token)

    def store_upload(
        self,
        *,
        context: FileGrantContext,
        filename: str,
        stream: IO[bytes],
        mimetype: str,
    ) -> StoredUpload:
        return self._files.store_upload_stream(
            context=context,
            filename=filename,
            stream=stream,
            mimetype=mimetype,
        )

    def store_remote_upload(self, *, context: FileGrantContext, url: str) -> StoredUpload:
        if not self._repository.subject_exists(context):
            raise EndUserNotFoundError(context.end_user_id)
        remote_file = self._remote_files.fetch(url)
        if remote_file is None:
            raise RemoteFileUnavailableError(url)
        return self._files.store_upload(
            context=context,
            filename=remote_file.filename,
            content=remote_file.content,
            mimetype=remote_file.mimetype,
            source_url=url,
        )

    def store_produced(
        self,
        *,
        context: FileGrantContext,
        filename: str | None,
        stream: IO[bytes],
        mimetype: str,
    ) -> tuple[StoredProducedFile, ResolvedFileAccess]:
        if not self._repository.subject_exists(context):
            raise EndUserNotFoundError(context.end_user_id)
        stored = self._files.store_produced(
            context=context,
            filename=filename,
            stream=stream,
            mimetype=mimetype,
        )
        file = ResolvedFile(stored.id, FileKind.TOOL, stored.name, stored.size, "", stored.mime_type)
        return stored, self._with_access(file)

    def resolve_files(
        self,
        *,
        context: FileGrantContext,
        refs: Sequence[FileRef],
    ) -> list[ResolvedFile | None]:
        self._validate_ref_count(refs)
        if not self._repository.subject_exists(context):
            raise EndUserNotFoundError(context.end_user_id)
        return self._repository.resolve_owned_files(context=context, refs=refs)

    def resolve_file_access(
        self,
        *,
        context: FileGrantContext,
        refs: Sequence[FileRef],
    ) -> list[ResolvedFileAccess | None]:
        return [
            self._with_access(file) if file is not None else None
            for file in self.resolve_files(context=context, refs=refs)
        ]

    def load_content(self, *, token: str, requested_file_id: str) -> FileContent | None:
        claims = self._tokens.decode_content_token(token)
        if claims is None:
            raise InvalidFileGrantError()
        if claims.file_id != requested_file_id:
            return None
        record = self._repository.get_content_record(file_id=requested_file_id, kind=claims.kind)
        return self._files.open_content(record) if record is not None else None

    def content_urls(self, *, file_id: str, kind: FileKind) -> tuple[str, str]:
        return self._tokens.issue_content_urls(file_id=file_id, kind=kind)

    def _with_access(self, file: ResolvedFile) -> ResolvedFileAccess:
        external_url, internal_url = self._tokens.issue_content_urls(file_id=file.id, kind=file.kind)
        return ResolvedFileAccess(file=file, external_url=external_url, internal_url=internal_url)

    def _effective_ttl_seconds(self, request: FileGrantMintRequest) -> int:
        if request.run_deadline is None:
            if request.ttl_seconds > MAX_SESSION_GRANT_TTL_SECONDS:
                raise GrantTtlTooLongError()
            return request.ttl_seconds

        now = self._now()
        if FileGrantScope.PRODUCE not in request.scopes:
            raise InvalidGrantRequestError("A run deadline requires the produce scope.")
        if request.run_deadline <= now:
            raise InvalidGrantRequestError("The run deadline has expired.")
        if request.run_deadline > now + MAX_WORKFLOW_EXECUTION_SECONDS:
            raise InvalidGrantRequestError("The run deadline exceeds the workflow execution limit.")
        if request.ttl_seconds > MAX_RUN_GRANT_TTL_SECONDS:
            raise GrantTtlTooLongError()
        return min(request.ttl_seconds, request.run_deadline - now + RUN_GRANT_EXPIRY_GRACE_SECONDS)

    @staticmethod
    def _validate_subject(subject: str) -> None:
        if not subject.strip() or "\x00" in subject:
            raise InvalidSubjectError()

    @staticmethod
    def _validate_ref_count(refs: Sequence[FileRef]) -> None:
        if len(refs) > MAX_FILE_GRANT_REFS:
            raise TooManyFileRefsError(f"A file grant request may contain at most {MAX_FILE_GRANT_REFS} references.")


__all__ = [
    "MAX_FILE_GRANT_REFS",
    "MAX_RUN_GRANT_TTL_SECONDS",
    "MAX_SESSION_GRANT_TTL_SECONDS",
    "MAX_WORKFLOW_EXECUTION_SECONDS",
    "RUN_GRANT_EXPIRY_GRACE_SECONDS",
    "AppNotFoundError",
    "EndUserNotFoundError",
    "FileGrantService",
    "GrantTtlTooLongError",
    "GrantedFileNotFoundError",
    "InvalidFileGrantError",
    "InvalidGrantRequestError",
    "InvalidSubjectError",
    "RemoteFileUnavailableError",
    "TooManyFileRefsError",
]
