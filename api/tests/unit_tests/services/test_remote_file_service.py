from collections.abc import Callable
from pathlib import Path
from unittest.mock import MagicMock, call, patch

import httpx
import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session, sessionmaker

from core.file.remote_file_metadata import FileInfo, InvalidRemoteFileMetadataError
from core.helper.ssrf_proxy import MaxRetriesExceededError
from core.tools.errors import ToolSSRFError
from extensions.ext_storage import Storage
from extensions.storage.opendal_storage import OpenDALStorage
from models.model import Account, UploadFile
from services.errors.file import FileTooLargeError
from services.file_service import FileService
from services.remote_file_service import (
    RemoteFileAccessDeniedError,
    RemoteFileError,
    RemoteFileInvalidResponseError,
    RemoteFileInvalidUrlError,
    RemoteFileNotFoundError,
    RemoteFileService,
    RemoteFileUnavailableError,
    RemoteFileUploadResult,
    RemoteFileUrlBlockedError,
)
from tests.unit_tests.model_factories import make_tenant

REMOTE_URL = "https://example.com/files/report.pdf"


def _response(
    method: str,
    status_code: int,
    *,
    content: bytes = b"",
    headers: dict[str, str] | None = None,
) -> httpx.Response:
    return httpx.Response(
        status_code,
        content=content,
        headers=headers,
        request=httpx.Request(method, REMOTE_URL),
    )


def _account() -> Account:
    account = Account(name="Test Account", email="test@example.com")
    account.id = "account-id"
    account._current_tenant = make_tenant(tenant_id="tenant-id")
    return account


@pytest.fixture
def storage(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Storage:
    storage = Storage()
    storage.storage_runner = OpenDALStorage(scheme="fs", root=str(tmp_path))
    monkeypatch.setattr("services.file_service.storage", storage)
    return storage


@pytest.fixture
def file_service(sqlite_session_factory: sessionmaker[Session]) -> FileService:
    return FileService(sqlite_session_factory)


@pytest.fixture
def upload(file_service: FileService, mocker: MockerFixture) -> MagicMock:
    return mocker.spy(file_service, "upload_file")


@pytest.fixture
def size_check(file_service: FileService, mocker: MockerFixture) -> MagicMock:
    return mocker.spy(file_service, "is_file_size_within_limit")


@pytest.fixture
def remote_file_service(file_service: FileService) -> RemoteFileService:
    return RemoteFileService(files=file_service)


def test_fetch_info_uses_successful_head_response(remote_file_service: RemoteFileService) -> None:
    response = _response(
        "HEAD",
        httpx.codes.OK,
        headers={"Content-Type": "application/pdf", "Content-Length": "42"},
    )

    with patch("services.remote_file_service.remote_fetcher.make_request", return_value=response) as make_request:
        result = remote_file_service.fetch_info(url=REMOTE_URL)

    assert result.content_type == "application/pdf"
    assert result.content_length == 42
    make_request.assert_called_once_with("HEAD", url=REMOTE_URL)


def test_fetch_info_falls_back_to_get(remote_file_service: RemoteFileService) -> None:
    head_response = _response("HEAD", httpx.codes.METHOD_NOT_ALLOWED)
    get_response = _response("GET", httpx.codes.OK)

    with patch(
        "services.remote_file_service.remote_fetcher.make_request",
        side_effect=[head_response, get_response],
    ) as make_request:
        result = remote_file_service.fetch_info(url=REMOTE_URL)

    assert result.content_type == "application/octet-stream"
    assert result.content_length is None
    assert make_request.call_args_list == [call("HEAD", url=REMOTE_URL), call("GET", url=REMOTE_URL, timeout=3)]


@pytest.mark.parametrize(
    ("source_error", "service_error"),
    [
        (httpx.InvalidURL("invalid URL"), RemoteFileInvalidUrlError),
        (ToolSSRFError("blocked URL and internal proxy details"), RemoteFileUrlBlockedError),
        (MaxRetriesExceededError("maximum retries reached"), RemoteFileUnavailableError),
        (
            httpx.ConnectError("network down", request=httpx.Request("HEAD", REMOTE_URL)),
            RemoteFileUnavailableError,
        ),
    ],
)
def test_fetch_info_translates_known_request_failures(
    remote_file_service: RemoteFileService,
    source_error: Exception,
    service_error: type[RemoteFileError],
) -> None:
    with patch("services.remote_file_service.remote_fetcher.make_request", side_effect=source_error):
        with pytest.raises(service_error) as error_info:
            remote_file_service.fetch_info(url=REMOTE_URL)

    assert error_info.value.__cause__ is source_error


@pytest.mark.parametrize("url", ["not-a-url", "ftp://example.com/report.pdf", "http://", "http://[invalid"])
def test_fetch_info_rejects_invalid_url_without_requesting_it(
    remote_file_service: RemoteFileService,
    url: str,
) -> None:
    with patch("services.remote_file_service.remote_fetcher.make_request") as make_request:
        with pytest.raises(RemoteFileInvalidUrlError):
            remote_file_service.fetch_info(url=url)

    make_request.assert_not_called()


def test_fetch_info_does_not_translate_unknown_failure(remote_file_service: RemoteFileService) -> None:
    source_error = RuntimeError("database failure while resolving a signed file URL")

    with patch("services.remote_file_service.remote_fetcher.make_request", side_effect=source_error):
        with pytest.raises(RuntimeError) as error_info:
            remote_file_service.fetch_info(url=REMOTE_URL)

    assert error_info.value is source_error


@pytest.mark.parametrize(
    ("status_code", "service_error"),
    [
        (httpx.codes.NOT_FOUND, RemoteFileNotFoundError),
        (httpx.codes.GONE, RemoteFileNotFoundError),
        (httpx.codes.UNAUTHORIZED, RemoteFileAccessDeniedError),
        (httpx.codes.FORBIDDEN, RemoteFileAccessDeniedError),
        (httpx.codes.BAD_GATEWAY, RemoteFileUnavailableError),
    ],
)
def test_fetch_info_classifies_remote_status(
    remote_file_service: RemoteFileService,
    status_code: int,
    service_error: type[RemoteFileError],
) -> None:
    request = httpx.Request("HEAD", REMOTE_URL)
    response = httpx.Response(status_code, request=request, text="upstream response must not reach the client")

    with patch("services.remote_file_service.remote_fetcher.make_request", return_value=response):
        with pytest.raises(service_error):
            remote_file_service.fetch_info(url=REMOTE_URL)


def test_fetch_info_rejects_invalid_content_length(remote_file_service: RemoteFileService) -> None:
    response = _response("HEAD", httpx.codes.OK, headers={"Content-Length": "not-a-number"})

    with patch("services.remote_file_service.remote_fetcher.make_request", return_value=response):
        with pytest.raises(RemoteFileInvalidResponseError) as error_info:
            remote_file_service.fetch_info(url=REMOTE_URL)

    assert isinstance(error_info.value.__cause__, ValueError)


def test_upload_reuses_get_fallback_content_and_returns_signed_result(
    remote_file_service: RemoteFileService,
    upload: MagicMock,
    size_check: MagicMock,
    storage: Storage,
    sqlite_session: Session,
) -> None:
    account = _account()
    head_response = _response("HEAD", httpx.codes.METHOD_NOT_ALLOWED)
    get_response = _response("GET", httpx.codes.OK, content=b"remote content")
    file_info = FileInfo(filename="report.pdf", extension=".pdf", mimetype="application/pdf", size=14)
    with (
        patch(
            "services.remote_file_service.remote_fetcher.make_request",
            side_effect=[head_response, get_response],
        ) as make_request,
        patch("services.remote_file_service.guess_file_info_from_response", return_value=file_info),
        patch(
            "services.remote_file_service.file_helpers.get_signed_file_url",
            return_value="https://example.com/signed/upload-id",
        ) as get_signed_file_url,
    ):
        result = remote_file_service.upload_from_url(
            url=REMOTE_URL,
            user=account,
            tenant_id="tenant-id",
        )

    assert make_request.call_args_list == [
        call("HEAD", url=REMOTE_URL),
        call("GET", url=REMOTE_URL, timeout=3, follow_redirects=True),
    ]
    size_check.assert_called_once_with(extension=".pdf", file_size=14)
    upload.assert_called_once_with(
        filename="report.pdf",
        content=b"remote content",
        mimetype="application/pdf",
        user=account,
        tenant_id="tenant-id",
        source_url=REMOTE_URL,
    )
    upload_file = sqlite_session.get(UploadFile, result.id)
    assert upload_file is not None
    assert upload_file.tenant_id == "tenant-id"
    assert upload_file.source_url == REMOTE_URL
    assert storage.load_once(upload_file.key) == b"remote content"
    get_signed_file_url.assert_called_once_with(upload_file_id=result.id)
    assert result == RemoteFileUploadResult(
        id=result.id,
        name="report.pdf",
        size=14,
        extension="pdf",
        url="https://example.com/signed/upload-id",
        mime_type="application/pdf",
        created_by="account-id",
        created_at=upload_file.created_at,
    )


def test_upload_fetches_content_after_successful_head(
    remote_file_service: RemoteFileService,
    upload: MagicMock,
    storage: Storage,
    sqlite_session: Session,
) -> None:
    account = _account()
    head_response = _response("HEAD", httpx.codes.OK)
    content_response = _response("GET", httpx.codes.OK, content=b"downloaded content")
    file_info = FileInfo(filename="report.pdf", extension=".pdf", mimetype="application/pdf", size=18)
    with (
        patch(
            "services.remote_file_service.remote_fetcher.make_request",
            side_effect=[head_response, content_response],
        ) as make_request,
        patch("services.remote_file_service.guess_file_info_from_response", return_value=file_info),
        patch("services.remote_file_service.file_helpers.get_signed_file_url", return_value="signed-url"),
    ):
        result = remote_file_service.upload_from_url(url=REMOTE_URL, user=account)

    assert make_request.call_args_list == [call("HEAD", url=REMOTE_URL), call("GET", url=REMOTE_URL)]
    assert upload.call_args.kwargs["content"] == b"downloaded content"
    assert upload.call_args.kwargs["tenant_id"] is None
    upload_file = sqlite_session.get(UploadFile, result.id)
    assert upload_file is not None
    assert upload_file.tenant_id == "tenant-id"
    assert storage.load_once(upload_file.key) == b"downloaded content"


def test_upload_rejects_failed_content_download(
    remote_file_service: RemoteFileService,
    upload: MagicMock,
) -> None:
    head_response = _response("HEAD", httpx.codes.OK)
    content_response = _response("GET", httpx.codes.BAD_GATEWAY, content=b"bad gateway")
    file_info = FileInfo(filename="report.pdf", extension=".pdf", mimetype="application/pdf", size=14)

    with (
        patch(
            "services.remote_file_service.remote_fetcher.make_request",
            side_effect=[head_response, content_response],
        ),
        patch("services.remote_file_service.guess_file_info_from_response", return_value=file_info),
    ):
        with pytest.raises(RemoteFileUnavailableError):
            remote_file_service.upload_from_url(url=REMOTE_URL, user=_account())

    upload.assert_not_called()


def test_upload_rejects_invalid_remote_metadata(
    remote_file_service: RemoteFileService,
    upload: MagicMock,
) -> None:
    response = _response("GET", httpx.codes.OK, content=b"remote content")
    metadata_error = InvalidRemoteFileMetadataError("invalid Content-Length")

    with (
        patch("services.remote_file_service.remote_fetcher.make_request", return_value=response),
        patch("services.remote_file_service.guess_file_info_from_response", side_effect=metadata_error),
    ):
        with pytest.raises(RemoteFileInvalidResponseError) as error_info:
            remote_file_service.upload_from_url(url=REMOTE_URL, user=_account())

    assert error_info.value.__cause__ is metadata_error
    upload.assert_not_called()


def test_upload_does_not_translate_unknown_metadata_failure(
    remote_file_service: RemoteFileService,
    upload: MagicMock,
) -> None:
    response = _response("GET", httpx.codes.OK, content=b"remote content")
    source_error = ValueError("unexpected parser bug")

    with (
        patch("services.remote_file_service.remote_fetcher.make_request", return_value=response),
        patch("services.remote_file_service.guess_file_info_from_response", side_effect=source_error),
    ):
        with pytest.raises(RuntimeError) as error_info:
            remote_file_service.upload_from_url(url=REMOTE_URL, user=_account())

    assert error_info.value.__cause__ is source_error
    upload.assert_not_called()


def test_upload_rejects_remote_filename_with_path_separator(
    remote_file_service: RemoteFileService,
    upload: MagicMock,
) -> None:
    response = _response("GET", httpx.codes.OK, content=b"remote content")
    file_info = FileInfo(filename="folder/report.pdf", extension=".pdf", mimetype="application/pdf", size=14)

    with (
        patch("services.remote_file_service.remote_fetcher.make_request", return_value=response),
        patch("services.remote_file_service.guess_file_info_from_response", return_value=file_info),
    ):
        with pytest.raises(RemoteFileInvalidResponseError):
            remote_file_service.upload_from_url(url=REMOTE_URL, user=_account())

    upload.assert_not_called()


def test_upload_rejects_file_that_exceeds_size_limit(
    remote_file_service: RemoteFileService,
    upload: MagicMock,
    size_check: MagicMock,
    config_overrides: Callable[..., None],
) -> None:
    response = _response("GET", httpx.codes.OK, content=b"remote content")
    file_info = FileInfo(filename="report.pdf", extension=".pdf", mimetype="application/pdf", size=1024)
    config_overrides(UPLOAD_FILE_SIZE_LIMIT=0)

    with (
        patch("services.remote_file_service.remote_fetcher.make_request", return_value=response),
        patch("services.remote_file_service.guess_file_info_from_response", return_value=file_info),
    ):
        with pytest.raises(FileTooLargeError):
            remote_file_service.upload_from_url(url=REMOTE_URL, user=_account())

    size_check.assert_called_once_with(extension=".pdf", file_size=1024)
    upload.assert_not_called()
