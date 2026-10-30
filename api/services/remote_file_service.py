import urllib.parse
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

import httpx

from core.file import remote_fetcher
from core.file.remote_file_metadata import FileInfo, InvalidRemoteFileMetadataError, guess_file_info_from_response
from core.helper import ssrf_proxy
from core.helper.ssrf_proxy import MaxRetriesExceededError
from core.tools.errors import ToolSSRFError
from graphon.file import helpers as file_helpers
from services.entities.upload_file import FileUploadActor
from services.errors.file import FileTooLargeError
from services.file_service import FileService
from services.file_upload_policy import file_size_limit


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
            response.close()
            response = self._request("GET", url=url, timeout=3, stream_response=True)
        try:
            self._ensure_success(response)
            return RemoteFileInfoResult(
                content_type=response.headers.get("Content-Type", "application/octet-stream"),
                content_length=self._content_length(response),
            )
        finally:
            response.close()

    def upload_from_url(
        self,
        *,
        url: str,
        actor: FileUploadActor,
        tenant_id: str,
    ) -> RemoteFileUploadResult:
        """Fetch and persist a remote file under an explicitly admitted tenant."""

        metadata = self._fetch_for_upload(url=url)
        try:
            metadata_info = self._file_info(metadata)
            self._response_limit(metadata_info)
            if metadata.request.method == "GET":
                file_info, content = self._read_upload_response(metadata)
                metadata = None
            else:
                file_info, content = self._fetch_content(url=url)
        finally:
            if metadata is not None:
                metadata.close()

        upload_file = self._files.upload_file(
            filename=file_info.filename,
            content=content,
            mimetype=file_info.mimetype,
            actor=actor,
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
    def _fetch_for_upload(cls, *, url: str) -> httpx.Response:
        """Return a successful metadata response whose lifetime belongs to the caller."""

        response = cls._request("HEAD", url=url)
        if response.status_code != httpx.codes.OK:
            response.close()
            response = cls._request(
                "GET",
                url=url,
                timeout=3,
                follow_redirects=True,
                stream_response=True,
            )

        try:
            cls._ensure_success(response)
        except Exception:
            response.close()
            raise
        return response

    @staticmethod
    def _ensure_success(response: httpx.Response) -> None:
        if response.status_code == httpx.codes.OK:
            return

        if response.status_code in {httpx.codes.NOT_FOUND, httpx.codes.GONE}:
            raise RemoteFileNotFoundError("The remote file does not exist")
        if response.status_code in {httpx.codes.UNAUTHORIZED, httpx.codes.FORBIDDEN}:
            raise RemoteFileAccessDeniedError("The remote file cannot be accessed anonymously")

        raise RemoteFileUnavailableError(f"The remote file request returned HTTP {response.status_code}")

    @classmethod
    def _fetch_content(cls, *, url: str) -> tuple[FileInfo, bytes]:
        response = cls._request("GET", url=url, follow_redirects=True, stream_response=True)
        return cls._read_upload_response(response)

    @classmethod
    def _read_upload_response(cls, response: httpx.Response) -> tuple[FileInfo, bytes]:
        try:
            cls._ensure_success(response)
            metadata_info = cls._file_info(response)
            limit = cls._response_limit(metadata_info)
            try:
                buffered = ssrf_proxy.buffer_response(response, max_response_bytes=max(limit, 1))
            except ssrf_proxy.ResponseTooLargeError as error:
                raise FileTooLargeError() from error
            except ssrf_proxy.UnsupportedResponseEncodingError as error:
                raise RemoteFileInvalidResponseError(
                    "The remote response uses an unsupported content encoding"
                ) from error
            if len(buffered.content) > limit:
                raise FileTooLargeError()
            file_info = cls._file_info(buffered, include_content=True)
            final_limit = cls._response_limit(file_info)
            if len(buffered.content) > final_limit:
                raise FileTooLargeError()
            return file_info, buffered.content
        except httpx.RequestError as error:
            raise RemoteFileUnavailableError("The remote file request failed while reading its content") from error
        finally:
            response.close()

    @classmethod
    def _file_info(cls, response: httpx.Response, *, include_content: bool = False) -> FileInfo:
        metadata = httpx.Response(
            response.status_code,
            headers=response.headers,
            content=response.content if include_content else b"",
            request=response.request,
        )
        try:
            file_info = guess_file_info_from_response(metadata)
        except InvalidRemoteFileMetadataError as error:
            raise RemoteFileInvalidResponseError("The remote response contains invalid file metadata") from error
        except ValueError as error:
            # Unclassified parser failures are server bugs, not invalid request parameters.
            raise RuntimeError("Unexpected remote file metadata parsing failure") from error

        if any(separator in file_info.filename for separator in ("/", "\\")):
            raise RemoteFileInvalidResponseError("The remote response contains an invalid filename")
        return file_info

    @staticmethod
    def _response_limit(file_info: FileInfo) -> int:
        extension = file_info.extension.lstrip(".").lower()
        limit = file_size_limit(extension=extension)
        if file_info.size >= 0 and file_info.size > limit:
            raise FileTooLargeError()
        return limit

    @staticmethod
    def _content_length(response: httpx.Response) -> int | None:
        value = response.headers.get("Content-Length")
        if value is None:
            return None
        try:
            size = int(value)
        except ValueError as error:
            raise RemoteFileInvalidResponseError("The remote response has an invalid Content-Length header") from error
        if size < 0:
            raise RemoteFileInvalidResponseError("The remote response has an invalid Content-Length header")
        return size
