from collections.abc import Iterator
from pathlib import Path
from typing import override
from unittest.mock import MagicMock, call, patch

import httpx
import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session, sessionmaker

from core.file.remote_file_metadata import FileInfo, InvalidRemoteFileMetadataError
from core.helper.ssrf_proxy import MaxRetriesExceededError
from core.tools.errors import ToolSSRFError
from enums.creator import CreatorUserRole
from extensions.ext_storage import Storage
from extensions.storage.opendal_storage import OpenDALStorage
from models.model import UploadFile
from services.entities.upload_file import FileUploadActor
from services.errors.file import FileTooLargeError
from services.file_adapters import build_file_service
from services.file_service import FileService
from services.remote_file_service import (
    RemoteFileAccessDeniedError,
    RemoteFileError,
    RemoteFileInfoResult,
    RemoteFileInvalidResponseError,
    RemoteFileInvalidUrlError,
    RemoteFileNotFoundError,
    RemoteFileService,
    RemoteFileUnavailableError,
    RemoteFileUploadResult,
    RemoteFileUrlBlockedError,
)

REMOTE_URL = "https://example.com/files/report.pdf"
pytestmark = pytest.mark.usefixtures("storage")


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


class _TrackingStream(httpx.SyncByteStream):
    def __init__(self, chunks: list[bytes]) -> None:
        self._chunks = chunks
        self.chunks_yielded = 0
        self.closed = False

    @override
    def __iter__(self) -> Iterator[bytes]:
        for chunk in self._chunks:
            self.chunks_yielded += 1
            yield chunk

    @override
    def close(self) -> None:
        self.closed = True


class _MagicStub:
    MagicException = ValueError

    def __init__(self) -> None:
        self.calls: list[tuple[bytes, bool]] = []

    def from_buffer(self, content: bytes, *, mime: bool) -> str:
        self.calls.append((content, mime))
        return "image/png" if content else "application/octet-stream"


def _streaming_response(
    *,
    stream: _TrackingStream,
    headers: dict[str, str] | None = None,
    url: str = REMOTE_URL,
) -> httpx.Response:
    return httpx.Response(
        httpx.codes.OK,
        headers=headers,
        stream=stream,
        request=httpx.Request("GET", url),
    )


def _actor() -> FileUploadActor:
    return FileUploadActor(id="account-id", creator_role=CreatorUserRole.ACCOUNT)


@pytest.fixture
def storage(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Storage:
    storage = Storage()
    storage.storage_runner = OpenDALStorage(scheme="fs", root=str(tmp_path))
    monkeypatch.setattr("services.file_adapters.storage", storage)
    return storage


@pytest.fixture
def file_service(sqlite_session_factory: sessionmaker[Session]) -> FileService:
    return build_file_service(session_factory=sqlite_session_factory)


@pytest.fixture
def upload(file_service: FileService, mocker: MockerFixture) -> MagicMock:
    return mocker.spy(file_service, "upload_file")


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
    assert make_request.call_args_list == [
        call("HEAD", url=REMOTE_URL),
        call("GET", url=REMOTE_URL, timeout=3, stream_response=True),
    ]


def test_fetch_info_fallback_closes_get_without_reading_body(remote_file_service: RemoteFileService) -> None:
    head_response = _response("HEAD", httpx.codes.METHOD_NOT_ALLOWED)
    stream = _TrackingStream([b"large-body-must-not-be-read"])
    get_response = _streaming_response(stream=stream, headers={"Content-Type": "application/pdf"})

    with patch(
        "services.remote_file_service.remote_fetcher.make_request",
        side_effect=[head_response, get_response],
    ):
        result = remote_file_service.fetch_info(url=REMOTE_URL)

    assert result == RemoteFileInfoResult(content_type="application/pdf", content_length=None)
    assert stream.chunks_yielded == 0
    assert stream.closed is True
    assert head_response.is_closed is True


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
    storage: Storage,
    sqlite_session: Session,
) -> None:
    actor = _actor()
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
            actor=actor,
            tenant_id="tenant-id",
        )

    assert make_request.call_args_list == [
        call("HEAD", url=REMOTE_URL),
        call("GET", url=REMOTE_URL, timeout=3, follow_redirects=True, stream_response=True),
    ]
    upload.assert_called_once_with(
        filename="report.pdf",
        content=b"remote content",
        mimetype="application/pdf",
        actor=actor,
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


def test_upload_sniffs_bounded_get_fallback_content_for_opaque_url(
    remote_file_service: RemoteFileService,
    upload: MagicMock,
) -> None:
    opaque_url = "https://example.com/download"
    head_response = httpx.Response(
        httpx.codes.METHOD_NOT_ALLOWED,
        request=httpx.Request("HEAD", opaque_url),
    )
    body = b"\x89PNG\r\n\x1a\nimage-content"
    stream = _TrackingStream([body])
    get_response = _streaming_response(
        stream=stream,
        headers={"Content-Type": "application/octet-stream"},
        url=opaque_url,
    )
    magic = _MagicStub()

    def limit_for_extension(*, extension: str) -> int:
        return {"bin": 64, "png": 32}[extension]

    with (
        patch(
            "services.remote_file_service.remote_fetcher.make_request",
            side_effect=[head_response, get_response],
        ),
        patch("core.file.remote_file_metadata.magic", magic),
        patch("services.remote_file_service.file_size_limit", side_effect=limit_for_extension) as size_limit,
        patch("services.remote_file_service.file_helpers.get_signed_file_url", return_value="signed-url"),
    ):
        remote_file_service.upload_from_url(url=opaque_url, actor=_actor(), tenant_id="tenant-id")

    assert stream.chunks_yielded == 1
    assert stream.closed is True
    assert magic.calls == [
        (b"", True),
        (b"", True),
        (body, True),
    ]
    assert size_limit.call_args_list == [
        call(extension="bin"),
        call(extension="bin"),
        call(extension="png"),
    ]
    assert upload.call_args.kwargs["filename"] == "download.png"
    assert upload.call_args.kwargs["mimetype"] == "image/png"
    assert upload.call_args.kwargs["content"] == body


def test_upload_rejects_body_over_sniffed_extension_limit(
    remote_file_service: RemoteFileService,
    upload: MagicMock,
) -> None:
    opaque_url = "https://example.com/download"
    head_response = httpx.Response(
        httpx.codes.METHOD_NOT_ALLOWED,
        request=httpx.Request("HEAD", opaque_url),
    )
    body = b"\x89PNG\r\n\x1a\nimage-content"
    stream = _TrackingStream([body])
    get_response = _streaming_response(
        stream=stream,
        headers={"Content-Type": "application/octet-stream"},
        url=opaque_url,
    )

    magic = _MagicStub()

    def limit_for_extension(*, extension: str) -> int:
        return {"bin": 64, "png": 16}[extension]

    with (
        patch(
            "services.remote_file_service.remote_fetcher.make_request",
            side_effect=[head_response, get_response],
        ),
        patch("core.file.remote_file_metadata.magic", magic),
        patch("services.remote_file_service.file_size_limit", side_effect=limit_for_extension) as size_limit,
    ):
        with pytest.raises(FileTooLargeError):
            remote_file_service.upload_from_url(url=opaque_url, actor=_actor(), tenant_id="tenant-id")

    assert stream.chunks_yielded == 1
    assert stream.closed is True
    assert size_limit.call_args_list == [
        call(extension="bin"),
        call(extension="bin"),
        call(extension="png"),
    ]
    upload.assert_not_called()


def test_upload_fetches_content_after_successful_head(
    remote_file_service: RemoteFileService,
    upload: MagicMock,
    storage: Storage,
    sqlite_session: Session,
) -> None:
    actor = _actor()
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
        result = remote_file_service.upload_from_url(url=REMOTE_URL, actor=actor, tenant_id="tenant-id")

    assert make_request.call_args_list == [
        call("HEAD", url=REMOTE_URL),
        call("GET", url=REMOTE_URL, follow_redirects=True, stream_response=True),
    ]
    assert upload.call_args.kwargs["content"] == b"downloaded content"
    assert upload.call_args.kwargs["tenant_id"] == "tenant-id"
    upload_file = sqlite_session.get(UploadFile, result.id)
    assert upload_file is not None
    assert upload_file.tenant_id == "tenant-id"
    assert storage.load_once(upload_file.key) == b"downloaded content"


def test_upload_rejects_body_larger_than_successful_head_claim(
    remote_file_service: RemoteFileService,
    upload: MagicMock,
) -> None:
    head_response = _response("HEAD", httpx.codes.OK, headers={"Content-Length": "1"})
    stream = _TrackingStream([b"1234", b"5678", b"must-not-be-read"])
    content_response = _streaming_response(stream=stream)

    with (
        patch(
            "services.remote_file_service.remote_fetcher.make_request",
            side_effect=[head_response, content_response],
        ) as make_request,
        patch("services.remote_file_service.file_size_limit", return_value=5),
    ):
        with pytest.raises(FileTooLargeError):
            remote_file_service.upload_from_url(url=REMOTE_URL, actor=_actor(), tenant_id="tenant-id")

    assert make_request.call_args_list == [
        call("HEAD", url=REMOTE_URL),
        call("GET", url=REMOTE_URL, follow_redirects=True, stream_response=True),
    ]
    assert stream.chunks_yielded == 2
    assert stream.closed is True
    upload.assert_not_called()


def test_upload_accepts_bounded_body_without_content_length(
    remote_file_service: RemoteFileService,
    upload: MagicMock,
) -> None:
    head_response = _response("HEAD", httpx.codes.OK)
    stream = _TrackingStream([b"abc", b"de"])
    content_response = _streaming_response(stream=stream)

    with (
        patch(
            "services.remote_file_service.remote_fetcher.make_request",
            side_effect=[head_response, content_response],
        ),
        patch("services.remote_file_service.file_size_limit", return_value=8),
        patch("services.remote_file_service.file_helpers.get_signed_file_url", return_value="signed-url"),
    ):
        result = remote_file_service.upload_from_url(url=REMOTE_URL, actor=_actor(), tenant_id="tenant-id")

    assert result.size == 5
    assert upload.call_args.kwargs["content"] == b"abcde"
    assert stream.chunks_yielded == 2
    assert stream.closed is True


def test_upload_applies_limit_for_actual_get_extension(
    remote_file_service: RemoteFileService,
    upload: MagicMock,
) -> None:
    head_response = _response("HEAD", httpx.codes.OK, headers={"Content-Length": "4"})
    stream = _TrackingStream([b"123456"])
    content_response = _streaming_response(
        stream=stream,
        headers={"Content-Type": "image/png"},
        url="https://example.com/files/actual.png",
    )

    def limit_for_extension(*, extension: str) -> int:
        return {"pdf": 10, "png": 5}[extension]

    with (
        patch(
            "services.remote_file_service.remote_fetcher.make_request",
            side_effect=[head_response, content_response],
        ),
        patch("services.remote_file_service.file_size_limit", side_effect=limit_for_extension) as size_limit,
    ):
        with pytest.raises(FileTooLargeError):
            remote_file_service.upload_from_url(url=REMOTE_URL, actor=_actor(), tenant_id="tenant-id")

    assert size_limit.call_args_list == [call(extension="pdf"), call(extension="png")]
    assert stream.closed is True
    upload.assert_not_called()


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
            remote_file_service.upload_from_url(url=REMOTE_URL, actor=_actor(), tenant_id="tenant-id")

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
            remote_file_service.upload_from_url(url=REMOTE_URL, actor=_actor(), tenant_id="tenant-id")

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
            remote_file_service.upload_from_url(url=REMOTE_URL, actor=_actor(), tenant_id="tenant-id")

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
            remote_file_service.upload_from_url(url=REMOTE_URL, actor=_actor(), tenant_id="tenant-id")

    upload.assert_not_called()


def test_upload_rejects_file_that_exceeds_size_limit(
    remote_file_service: RemoteFileService,
    upload: MagicMock,
) -> None:
    response = _response("GET", httpx.codes.OK, content=b"remote content")
    file_info = FileInfo(filename="report.pdf", extension=".pdf", mimetype="application/pdf", size=1024)

    with (
        patch("services.remote_file_service.remote_fetcher.make_request", return_value=response),
        patch("services.remote_file_service.guess_file_info_from_response", return_value=file_info),
        patch("services.remote_file_service.file_size_limit", return_value=512) as size_limit,
    ):
        with pytest.raises(FileTooLargeError):
            remote_file_service.upload_from_url(url=REMOTE_URL, actor=_actor(), tenant_id="tenant-id")

    size_limit.assert_called_once_with(extension="pdf")
    upload.assert_not_called()
