import urllib.parse
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

import httpx

from core.file import remote_fetcher
from core.file.remote_file_metadata import InvalidRemoteFileMetadataError, guess_file_info_from_response
from core.helper import ssrf_proxy
from core.helper.ssrf_proxy import MaxRetriesExceededError
from core.tools.errors import ToolSSRFError
from graphon.file import helpers as file_helpers
from models import Account
from models.model import EndUser
from services.errors.file import FileTooLargeError
from services.file_service import FileService


@dataclass(frozen=True, slots=True)
class RemoteFileInfoResult:
    content_type: str
    content_length: int | None


@dataclass(frozen=True, slots=True)
class RemoteFileUploadResult:
    id: str
    name: str
    size: int
    extension: str
    url: str
    mime_type: str | None
    created_by: str
    created_at: datetime


class RemoteFileError(Exception):
    pass


class RemoteFileInvalidUrlError(RemoteFileError):
    pass


class RemoteFileUrlBlockedError(RemoteFileError):
    pass


class RemoteFileNotFoundError(RemoteFileError):
    pass


class RemoteFileAccessDeniedError(RemoteFileError):
    pass


class RemoteFileUnavailableError(RemoteFileError):
    pass


class RemoteFileInvalidResponseError(RemoteFileError):
    pass


class RemoteFileService:
    def __init__(self, *, files: FileService) -> None:
        self._files = files

    def fetch_info(self, *, url: str) -> RemoteFileInfoResult:
        response = self._request("HEAD", url=url)
        if response.status_code != httpx.codes.OK:
            # Fall back to GET for servers that refuse HEAD, but stream so only
            # headers are inspected — the body must never be buffered by a probe.
            response = self._request("GET", url=url, timeout=3, stream_response=True)
            try:
                return self._info_from_response(response)
            finally:
                response.close()
        return self._info_from_response(response)

    @staticmethod
    def _info_from_response(response: httpx.Response) -> RemoteFileInfoResult:
        RemoteFileService._ensure_success(response)

        content_length = response.headers.get("Content-Length")
        try:
            parsed_content_length = int(content_length) if content_length is not None else None
        except ValueError as error:
            raise RemoteFileInvalidResponseError("The remote response has an invalid Content-Length header") from error

        return RemoteFileInfoResult(
            content_type=response.headers.get("Content-Type", "application/octet-stream"),
            content_length=parsed_content_length,
        )

    def upload_from_url(
        self,
        *,
        url: str,
        user: Account | EndUser,
        tenant_id: str | None = None,
    ) -> RemoteFileUploadResult:
        metadata, content = self._fetch_for_upload(url=url)
        try:
            file_info = guess_file_info_from_response(metadata)
        except InvalidRemoteFileMetadataError as error:
            raise RemoteFileInvalidResponseError("The remote response contains invalid file metadata") from error
        except ValueError as error:
            # Unclassified parser failures are server bugs, not invalid request parameters.
            raise RuntimeError("Unexpected remote file metadata parsing failure") from error

        if any(separator in file_info.filename for separator in ("/", "\\")):
            raise RemoteFileInvalidResponseError("The remote response contains an invalid filename")

        if not self._files.is_file_size_within_limit(
            extension=file_info.extension,
            file_size=file_info.size,
        ):
            raise FileTooLargeError()

        extension_limit = FileService.file_size_limit(extension=file_info.extension)
        if content is None:
            content = self._fetch_content(url=url, limit=extension_limit)
        elif len(content) > extension_limit:
            # The fallback metadata read was bounded by the largest configured
            # allowance, so enforce the file's own extension limit here.
            raise FileTooLargeError()

        upload_file = self._files.upload_file(
            filename=file_info.filename,
            content=content,
            mimetype=file_info.mimetype,
            user=user,
            tenant_id=tenant_id,
            source_url=url,
        )
        return RemoteFileUploadResult(
            id=upload_file.id,
            name=upload_file.name,
            size=upload_file.size,
            extension=upload_file.extension,
            url=file_helpers.get_signed_file_url(upload_file_id=upload_file.id),
            mime_type=upload_file.mime_type,
            created_by=upload_file.created_by,
            created_at=upload_file.created_at,
        )

    @staticmethod
    def _request(
        method: Literal["GET", "HEAD"],
        *,
        url: str,
        **kwargs: Any,
    ) -> httpx.Response:
        try:
            parsed_url = urllib.parse.urlsplit(url)
            port = parsed_url.port
        except ValueError as error:
            raise RemoteFileInvalidUrlError("The remote file URL is invalid") from error

        if parsed_url.scheme not in {"http", "https"} or parsed_url.hostname is None or port == 0:
            raise RemoteFileInvalidUrlError("The remote file URL is invalid")

        try:
            return remote_fetcher.make_request(method, url=url, **kwargs)
        except httpx.InvalidURL as error:
            raise RemoteFileInvalidUrlError("The remote file URL is invalid") from error
        except ToolSSRFError as error:
            raise RemoteFileUrlBlockedError("The remote file URL was blocked by SSRF protection") from error
        except (MaxRetriesExceededError, httpx.RequestError) as error:
            raise RemoteFileUnavailableError("The remote file request failed") from error

    @classmethod
    def _fetch_for_upload(cls, *, url: str) -> tuple[httpx.Response, bytes | None]:
        """Fetch metadata for an upload, prefetching bounded content on GET fallback.

        Returns the metadata response plus prefetched body bytes when the metadata
        already came from a GET. Prefetched bytes are bounded by the largest
        configured upload allowance; the caller enforces the extension limit.
        """
        response = cls._request("HEAD", url=url)
        if response.status_code == httpx.codes.OK:
            return response, None

        # Some servers refuse HEAD: fall back to GET, but stream and bound the
        # read so a malicious response cannot exhaust server memory or disk.
        # The buffered response keeps headers and body for metadata guessing.
        fallback = cls._request("GET", url=url, timeout=3, follow_redirects=True, stream_response=True)
        try:
            cls._ensure_success(fallback)
        except Exception:
            fallback.close()
            raise
        buffered = cls._buffer_bounded(fallback, limit=_max_upload_bytes())
        return buffered, buffered.content

    @classmethod
    def _fetch_content(cls, *, url: str, limit: int) -> bytes:
        """Download upload content with a hard size bound.

        Streams the body and aborts once `limit` bytes are exceeded, so a
        server that lies about Content-Length cannot exhaust worker memory.
        """
        response = cls._request("GET", url=url, stream_response=True)
        try:
            cls._ensure_success(response)
        except Exception:
            response.close()
            raise
        return cls._buffer_bounded(response, limit=limit).content

    @staticmethod
    def _buffer_bounded(response: httpx.Response, *, limit: int) -> httpx.Response:
        """Buffer one streaming response under `limit` bytes (fail-closed)."""
        if limit <= 0:
            response.close()
            raise FileTooLargeError()
        try:
            return ssrf_proxy.buffer_response(response, max_response_bytes=limit)
        except ssrf_proxy.ResponseTooLargeError as error:
            raise FileTooLargeError() from error
        except ssrf_proxy.UnsupportedResponseEncodingError as error:
            # Encoded bodies cannot be size-bounded before decoding (gzip bomb),
            # so refuse them instead of buffering blindly.
            raise RemoteFileInvalidResponseError("The remote response uses an unsupported content encoding") from error

    @staticmethod
    def _ensure_success(response: httpx.Response) -> None:
        if response.status_code == httpx.codes.OK:
            return

        if response.status_code in {httpx.codes.NOT_FOUND, httpx.codes.GONE}:
            raise RemoteFileNotFoundError("The remote file does not exist")
        if response.status_code in {httpx.codes.UNAUTHORIZED, httpx.codes.FORBIDDEN}:
            raise RemoteFileAccessDeniedError("The remote file cannot be accessed anonymously")

        raise RemoteFileUnavailableError(f"The remote file request returned HTTP {response.status_code}")


def _max_upload_bytes() -> int:
    """Largest configured per-extension upload allowance, in bytes.

    Bounds reads taken before the file's extension is known (GET fallback
    prefetch). The extension-specific limit is still enforced afterwards.
    Representative extensions cover every branch of FileService.file_size_limit.
    """
    return max(FileService.file_size_limit(extension=extension) for extension in (".bin", ".png", ".mp4", ".mp3"))
