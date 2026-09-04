import urllib.parse
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

import httpx

from core.file import remote_fetcher
from core.file.remote_file_metadata import InvalidRemoteFileMetadataError, guess_file_info_from_response
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
            response = self._request("GET", url=url, timeout=3)
        self._ensure_success(response)

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
        response = self._fetch_for_upload(url=url)
        try:
            file_info = guess_file_info_from_response(response)
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

        if response.request.method == "GET":
            content = response.content
        else:
            content = self._fetch_content(url=url)

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
    def _fetch_for_upload(cls, *, url: str) -> httpx.Response:
        response = cls._request("HEAD", url=url)
        if response.status_code != httpx.codes.OK:
            response = cls._request("GET", url=url, timeout=3, follow_redirects=True)

        cls._ensure_success(response)
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
    def _fetch_content(cls, *, url: str) -> bytes:
        response = cls._request("GET", url=url)
        cls._ensure_success(response)
        return response.content
