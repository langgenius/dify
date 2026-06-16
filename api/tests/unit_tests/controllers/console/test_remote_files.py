from __future__ import annotations

import urllib.parse
from datetime import UTC, datetime
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock

import httpx
import pytest

from controllers.common.errors import FileTooLargeError, RemoteFileUploadError, UnsupportedFileTypeError
from controllers.console import remote_files as remote_files_module
from models import Account
from models.account import AccountStatus, TenantAccountRole
from services.errors.file import FileTooLargeError as ServiceFileTooLargeError
from services.errors.file import UnsupportedFileTypeError as ServiceUnsupportedFileTypeError


def _make_account(account_id: str = "u1") -> Account:
    account = Account(
        name="Test User",
        email=f"{account_id}@example.com",
        status=AccountStatus.ACTIVE,
    )
    account.id = account_id
    account.role = TenantAccountRole.OWNER
    return account


class _FakeResponse:
    def __init__(
        self,
        *,
        status_code: int = 200,
        headers: dict[str, str] | None = None,
        method: str = "GET",
        content: bytes = b"",
        text: str = "",
        error: Exception | None = None,
    ) -> None:
        self.status_code = status_code
        self.headers = headers or {}
        self.request = SimpleNamespace(method=method)
        self.content = content
        self.text = text
        self._error = error

    def raise_for_status(self) -> None:
        if self._error:
            raise self._error


def _mock_upload_dependencies(
    monkeypatch: pytest.MonkeyPatch,
    *,
    file_size_within_limit: bool = True,
):
    file_info = SimpleNamespace(
        filename="report.txt",
        extension=".txt",
        mimetype="text/plain",
        size=3,
    )
    monkeypatch.setattr(
        remote_files_module.helpers,
        "guess_file_info_from_response",
        MagicMock(return_value=file_info),
    )

    file_service_cls = MagicMock()
    file_service_cls.is_file_size_within_limit.return_value = file_size_within_limit
    monkeypatch.setattr(remote_files_module, "FileService", file_service_cls)
    current_user = _make_account()
    monkeypatch.setattr(remote_files_module, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(
        remote_files_module.file_helpers,
        "get_signed_file_url",
        lambda upload_file_id: f"https://signed.example/{upload_file_id}",
    )

    return file_service_cls, current_user


def test_get_remote_file_info_uses_head_when_successful(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = remote_files_module.GetRemoteFileInfo()
    handler = unwrap(api.get)
    decoded_url = "https://example.com/test.txt"
    encoded_url = urllib.parse.quote(decoded_url, safe="")

    head_resp = _FakeResponse(
        status_code=200,
        headers={"Content-Type": "text/plain", "Content-Length": "128"},
        method="HEAD",
    )
    make_request = MagicMock(return_value=head_resp)
    monkeypatch.setattr(remote_files_module.remote_fetcher, "make_request", make_request)

    with app.test_request_context(method="GET"):
        payload = handler(api, url=encoded_url)

    assert payload == {"file_type": "text/plain", "file_length": 128}
    make_request.assert_called_once_with("HEAD", decoded_url)


def test_get_remote_file_info_preserves_unencoded_target_query(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = remote_files_module.GetRemoteFileInfo()
    handler = unwrap(api.get)
    target_url = "http://example.com/api/aiagent/httpview/txt"
    query = "fileNameKey=cankao1_ce4305bc-be20-4c5d-8732-de1741d28e27"

    head_resp = _FakeResponse(
        status_code=200,
        headers={"Content-Type": "text/plain", "Content-Length": "128"},
        method="HEAD",
    )
    make_request = MagicMock(return_value=head_resp)
    monkeypatch.setattr(remote_files_module.remote_fetcher, "make_request", make_request)

    with app.test_request_context(f"/remote-files/{target_url}?{query}", method="GET"):
        payload = handler(api, url=target_url)

    assert payload == {"file_type": "text/plain", "file_length": 128}
    make_request.assert_called_once_with("HEAD", f"{target_url}?{query}")


def test_get_remote_file_info_falls_back_to_get_and_uses_default_headers(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = remote_files_module.GetRemoteFileInfo()
    handler = unwrap(api.get)
    decoded_url = "https://example.com/test.txt"
    encoded_url = urllib.parse.quote(decoded_url, safe="")

    make_request = MagicMock(
        side_effect=[
            _FakeResponse(status_code=503),
            _FakeResponse(status_code=200, headers={}, method="GET"),
        ]
    )
    monkeypatch.setattr(remote_files_module.remote_fetcher, "make_request", make_request)

    with app.test_request_context(method="GET"):
        payload = handler(api, url=encoded_url)

    assert payload == {"file_type": "application/octet-stream", "file_length": 0}
    assert make_request.call_args_list[0].args == ("HEAD", decoded_url)
    assert make_request.call_args_list[1].args == ("GET", decoded_url)
    assert make_request.call_args_list[1].kwargs == {"timeout": 3}


def test_remote_file_upload_success_when_fetch_falls_back_to_get(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = remote_files_module.RemoteFileUpload()
    handler = unwrap(api.post)
    url = "https://example.com/report.txt"

    get_resp = _FakeResponse(status_code=200, method="GET", content=b"fallback-content")
    make_request = MagicMock(side_effect=[_FakeResponse(status_code=404), get_resp])
    monkeypatch.setattr(remote_files_module.remote_fetcher, "make_request", make_request)

    file_service_cls, current_user = _mock_upload_dependencies(monkeypatch)
    upload_file = SimpleNamespace(
        id="file-1",
        name="report.txt",
        size=16,
        extension=".txt",
        mime_type="text/plain",
        created_by="u1",
        created_at=datetime(2024, 1, 1, tzinfo=UTC),
    )
    file_service_cls.return_value.upload_file.return_value = upload_file

    with app.test_request_context(method="POST", json={"url": url}):
        payload, status = handler(api, current_user)

    assert status == 201
    assert payload["id"] == "file-1"
    assert payload["url"] == "https://signed.example/file-1"
    assert make_request.call_args_list[0].args == ("HEAD",)
    assert make_request.call_args_list[0].kwargs == {"url": url}
    assert make_request.call_args_list[1].args == ("GET",)
    assert make_request.call_args_list[1].kwargs == {"url": url, "timeout": 3, "follow_redirects": True}
    file_service_cls.return_value.upload_file.assert_called_once_with(
        filename="report.txt",
        content=b"fallback-content",
        mimetype="text/plain",
        user=current_user,
        source_url=url,
    )


def test_remote_file_upload_fetches_content_with_second_get_when_head_succeeds(
    app, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = remote_files_module.RemoteFileUpload()
    handler = unwrap(api.post)
    url = "https://example.com/photo.jpg"

    head_resp = _FakeResponse(status_code=200, method="HEAD", content=b"head-content")
    extra_get_resp = _FakeResponse(status_code=200, method="GET", content=b"downloaded-content")
    make_request = MagicMock(side_effect=[head_resp, extra_get_resp])
    monkeypatch.setattr(remote_files_module.remote_fetcher, "make_request", make_request)

    file_service_cls, current_user = _mock_upload_dependencies(monkeypatch)
    upload_file = SimpleNamespace(
        id="file-2",
        name="photo.jpg",
        size=18,
        extension=".jpg",
        mime_type="image/jpeg",
        created_by="u1",
        created_at=datetime(2024, 1, 2, tzinfo=UTC),
    )
    file_service_cls.return_value.upload_file.return_value = upload_file

    with app.test_request_context(method="POST", json={"url": url}):
        payload, status = handler(api, current_user)

    assert status == 201
    assert payload["id"] == "file-2"
    assert make_request.call_args_list[1].args == ("GET", url)
    assert file_service_cls.return_value.upload_file.call_args.kwargs["content"] == b"downloaded-content"


def test_remote_file_upload_raises_when_fallback_get_still_not_ok(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = remote_files_module.RemoteFileUpload()
    handler = unwrap(api.post)
    url = "https://example.com/fail.txt"

    make_request = MagicMock(
        side_effect=[
            _FakeResponse(status_code=500),
            _FakeResponse(status_code=502, text="bad gateway"),
        ]
    )
    monkeypatch.setattr(remote_files_module.remote_fetcher, "make_request", make_request)

    with app.test_request_context(method="POST", json={"url": url}):
        with pytest.raises(RemoteFileUploadError, match=f"Failed to fetch file from {url}: bad gateway"):
            handler(api, _make_account())


def test_remote_file_upload_raises_on_httpx_request_error(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = remote_files_module.RemoteFileUpload()
    handler = unwrap(api.post)
    url = "https://example.com/fail.txt"

    request = httpx.Request("HEAD", url)
    make_request = MagicMock(side_effect=httpx.RequestError("network down", request=request))
    monkeypatch.setattr(remote_files_module.remote_fetcher, "make_request", make_request)

    with app.test_request_context(method="POST", json={"url": url}):
        with pytest.raises(RemoteFileUploadError, match=f"Failed to fetch file from {url}: network down"):
            handler(api, _make_account())


def test_remote_file_upload_rejects_oversized_file(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = remote_files_module.RemoteFileUpload()
    handler = unwrap(api.post)
    url = "https://example.com/large.bin"

    make_request = MagicMock(return_value=_FakeResponse(status_code=200, method="GET", content=b"payload"))
    monkeypatch.setattr(remote_files_module.remote_fetcher, "make_request", make_request)

    _, current_user = _mock_upload_dependencies(monkeypatch, file_size_within_limit=False)

    with app.test_request_context(method="POST", json={"url": url}):
        with pytest.raises(FileTooLargeError):
            handler(api, current_user)


def test_remote_file_upload_translates_service_file_too_large_error(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = remote_files_module.RemoteFileUpload()
    handler = unwrap(api.post)
    url = "https://example.com/large.bin"

    make_request = MagicMock(return_value=_FakeResponse(status_code=200, method="GET", content=b"payload"))
    monkeypatch.setattr(remote_files_module.remote_fetcher, "make_request", make_request)
    file_service_cls, current_user = _mock_upload_dependencies(monkeypatch)
    file_service_cls.return_value.upload_file.side_effect = ServiceFileTooLargeError("size exceeded")

    with app.test_request_context(method="POST", json={"url": url}):
        with pytest.raises(FileTooLargeError, match="size exceeded"):
            handler(api, current_user)


def test_remote_file_upload_translates_service_unsupported_type_error(app, monkeypatch: pytest.MonkeyPatch) -> None:
    api = remote_files_module.RemoteFileUpload()
    handler = unwrap(api.post)
    url = "https://example.com/file.exe"

    make_request = MagicMock(return_value=_FakeResponse(status_code=200, method="GET", content=b"payload"))
    monkeypatch.setattr(remote_files_module.remote_fetcher, "make_request", make_request)
    file_service_cls, current_user = _mock_upload_dependencies(monkeypatch)
    file_service_cls.return_value.upload_file.side_effect = ServiceUnsupportedFileTypeError()

    with app.test_request_context(method="POST", json={"url": url}):
        with pytest.raises(UnsupportedFileTypeError):
            handler(api, current_user)
