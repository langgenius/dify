from __future__ import annotations

import mimetypes
import os
import re
import urllib.parse
from collections.abc import Callable, Sequence
from typing import IO, cast
from uuid import uuid4

import httpx
import jwt
from pydantic import ValidationError

from core.file import remote_fetcher
from core.helper import ssrf_proxy
from core.tools.tool_file_manager import ToolFileManager, resolve_extension
from extensions.ext_storage import Storage
from models.model import EndUser
from services.entities.file_grant_entities import (
    FileContent,
    FileContentClaims,
    FileContentRecord,
    FileGrantClaims,
    FileGrantContext,
    FileGrantScope,
    FileKind,
    RemoteFile,
    StoredProducedFile,
    StoredUpload,
)
from services.errors.file import FileTooLargeError
from services.errors.file_grant import EndUserNotFoundError
from services.file_service import FileService

FILE_GRANT_AUDIENCE = "dify-files"
FILE_CONTENT_AUDIENCE = "dify-files-content"
_ALGORITHM = "HS256"


class FileGrantTokenGateway:
    def __init__(
        self,
        *,
        secret_key: str,
        external_files_url: str,
        internal_files_url: str,
        content_token_ttl_seconds: int,
        now: Callable[[], int],
    ) -> None:
        self._secret_key = secret_key
        self._external_files_url = external_files_url
        self._internal_files_url = internal_files_url
        self._content_token_ttl_seconds = content_token_ttl_seconds
        self._now = now

    def issue_grant(
        self,
        *,
        context: FileGrantContext,
        scopes: Sequence[FileGrantScope],
        ttl_seconds: int,
    ) -> tuple[str, int]:
        expires_at = self._now() + ttl_seconds
        token = jwt.encode(
            {
                "aud": FILE_GRANT_AUDIENCE,
                "sub": context.end_user_id,
                "tenant_id": context.tenant_id,
                "app_id": context.app_id,
                "scopes": [str(scope) for scope in scopes],
                "exp": expires_at,
            },
            self._secret_key,
            algorithm=_ALGORITHM,
        )
        return token, expires_at

    def decode_grant(self, token: str) -> FileGrantClaims | None:
        payload = self._decode(
            token, audience=FILE_GRANT_AUDIENCE, required=["exp", "sub", "tenant_id", "app_id", "scopes"]
        )
        if payload is None:
            return None
        try:
            return FileGrantClaims.model_validate(payload)
        except ValidationError:
            return None

    def issue_content_urls(self, *, file_id: str, kind: FileKind) -> tuple[str, str]:
        external_token = self._issue_content_token(file_id=file_id, kind=kind)
        internal_token = self._issue_content_token(file_id=file_id, kind=kind)
        path = f"/files/appdeploy/{file_id}/content"
        return (
            f"{self._external_files_url}{path}?token={external_token}",
            f"{self._internal_files_url}{path}?token={internal_token}",
        )

    def decode_content_token(self, token: str) -> FileContentClaims | None:
        payload = self._decode(
            token,
            audience=FILE_CONTENT_AUDIENCE,
            required=["exp", "kind", "file_id"],
        )
        if payload is None:
            return None
        try:
            return FileContentClaims.model_validate(payload)
        except ValidationError:
            return None

    def _issue_content_token(self, *, file_id: str, kind: FileKind) -> str:
        return jwt.encode(
            {
                "aud": FILE_CONTENT_AUDIENCE,
                "kind": str(kind),
                "file_id": file_id,
                "nonce": os.urandom(8).hex(),
                "exp": self._now() + self._content_token_ttl_seconds,
            },
            self._secret_key,
            algorithm=_ALGORITHM,
        )

    def _decode(self, token: str, *, audience: str, required: list[str]) -> dict[str, object] | None:
        try:
            return cast(
                dict[str, object],
                jwt.decode(
                    token,
                    self._secret_key,
                    algorithms=[_ALGORITHM],
                    audience=audience,
                    options={"require": ["aud", *required]},
                ),
            )
        except jwt.PyJWTError:
            return None


class FileGrantFileGateway:
    def __init__(
        self,
        *,
        load_end_user: Callable[[FileGrantContext], EndUser | None],
        subject_exists: Callable[[FileGrantContext], bool],
        file_service: FileService,
        tool_files: ToolFileManager,
        storage: Storage,
    ) -> None:
        self._load_end_user = load_end_user
        self._subject_exists = subject_exists
        self._file_service = file_service
        self._tool_files = tool_files
        self._storage = storage

    def store_upload_stream(
        self,
        *,
        context: FileGrantContext,
        filename: str,
        stream: IO[bytes],
        mimetype: str,
    ) -> StoredUpload:
        if not self._subject_exists(context):
            raise EndUserNotFoundError(context.end_user_id)
        extension = os.path.splitext(filename)[1].lstrip(".").lower()
        limit = FileService.file_size_limit(extension=extension)
        content = stream.read(limit + 1)
        if len(content) > limit:
            raise FileTooLargeError(f"File size exceeded. The limit is {limit} bytes.")
        return self.store_upload(
            context=context,
            filename=filename,
            content=content,
            mimetype=mimetype,
        )

    def store_upload(
        self,
        *,
        context: FileGrantContext,
        filename: str,
        content: bytes,
        mimetype: str,
        source_url: str = "",
    ) -> StoredUpload:
        end_user = self._load_end_user(context)
        if end_user is None:
            raise EndUserNotFoundError(context.end_user_id)
        upload = self._file_service.upload_file(
            filename=filename,
            content=content,
            mimetype=mimetype,
            user=end_user,
            source_url=source_url,
        )
        return StoredUpload(
            id=upload.id,
            name=upload.name,
            size=upload.size,
            extension=upload.extension,
            mime_type=upload.mime_type,
            created_by=upload.created_by,
            created_at=upload.created_at,
            tenant_id=upload.tenant_id,
            source_url=upload.source_url,
        )

    def store_produced(
        self,
        *,
        context: FileGrantContext,
        filename: str | None,
        stream: IO[bytes],
        mimetype: str,
    ) -> StoredProducedFile:
        extension = resolve_extension(filename=filename, mimetype=mimetype).lstrip(".").lower()
        limit = FileService.file_size_limit(extension=extension)
        content = stream.read(limit + 1)
        if len(content) > limit:
            raise FileTooLargeError(f"File size exceeded. The limit is {limit} bytes.")
        stored = self._tool_files.create_file_by_raw(
            user_id=context.end_user_id,
            tenant_id=context.tenant_id,
            conversation_id=None,
            file_binary=content,
            mimetype=mimetype,
            filename=filename,
        )
        return StoredProducedFile(
            id=stored.id,
            name=stored.name or "",
            size=stored.size,
            mime_type=stored.mimetype,
        )

    def open_content(self, record: FileContentRecord) -> FileContent:
        return FileContent(
            name=record.name,
            size=record.size,
            mime_type=record.mime_type,
            stream=self._storage.load(record.storage_key, stream=True),
        )


class FileGrantRemoteFileGateway:
    def fetch(self, url: str) -> RemoteFile | None:
        try:
            metadata = remote_fetcher.make_request("HEAD", url=url, follow_redirects=True)
            if metadata.status_code != httpx.codes.OK:
                metadata.close()
                metadata = remote_fetcher.make_request(
                    "GET",
                    url=url,
                    timeout=3,
                    follow_redirects=True,
                    stream_response=True,
                )
            if metadata.status_code != httpx.codes.OK:
                metadata.close()
                return None

            filename, extension, mimetype = self._file_info(metadata)
            limit = FileService.file_size_limit(extension=extension)
            declared_size = self._declared_size(metadata)
            if declared_size is not None and declared_size > limit:
                metadata.close()
                raise FileTooLargeError(f"File size exceeded. The limit is {limit} bytes.")

            if metadata.request.method == "HEAD":
                metadata.close()
                response = remote_fetcher.make_request(
                    "GET",
                    url=url,
                    timeout=3,
                    follow_redirects=True,
                    stream_response=True,
                )
                if response.status_code != httpx.codes.OK:
                    response.close()
                    return None
            else:
                response = metadata

            try:
                buffered = ssrf_proxy.buffer_response(response, max_response_bytes=limit)
            except ssrf_proxy.ResponseTooLargeError as exc:
                raise FileTooLargeError(f"File size exceeded. The limit is {limit} bytes.") from exc
            return RemoteFile(filename=filename, mimetype=mimetype, content=buffered.content)
        except (httpx.RequestError, ssrf_proxy.UnsupportedResponseEncodingError):
            return None

    @staticmethod
    def _file_info(response: httpx.Response) -> tuple[str, str, str]:
        parsed_url = urllib.parse.urlparse(str(response.url))
        filename = urllib.parse.unquote(os.path.basename(parsed_url.path))
        if not filename:
            content_disposition = response.headers.get("Content-Disposition", "")
            filename_match = re.search(r'filename="?([^";]+)', content_disposition)
            filename = filename_match.group(1) if filename_match else uuid4().hex
        extension = os.path.splitext(filename)[1].lstrip(".").lower()
        mimetype = (
            mimetypes.guess_type(filename)[0]
            or response.headers.get("Content-Type", "").split(";", 1)[0].strip()
            or "application/octet-stream"
        )
        return filename, extension, mimetype

    @staticmethod
    def _declared_size(response: httpx.Response) -> int | None:
        value = response.headers.get("Content-Length")
        if value is None:
            return None
        try:
            return int(value)
        except ValueError:
            return None


__all__ = [
    "FILE_CONTENT_AUDIENCE",
    "FILE_GRANT_AUDIENCE",
    "FileGrantFileGateway",
    "FileGrantRemoteFileGateway",
    "FileGrantTokenGateway",
]
