import base64
import hashlib
import hmac
import urllib.parse
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from unittest.mock import MagicMock

import httpx
import pytest
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session, sessionmaker

from core.datasource.datasource_file_manager import DatasourceFileManager
from core.file import remote_fetcher
from core.tools.signature import sign_tool_file, sign_upload_file_preview_url
from core.tools.tool_file_manager import ToolFileManager
from extensions.storage.storage_type import StorageType
from models import CreatorUserRole, ToolFile, UploadFile

UPLOAD_FILE_ID = "1602650a-4fe4-423c-85a2-af76c083e3c4"
TOOL_FILE_ID = "2602650a-4fe4-423c-85a2-af76c083e3c4"
DATASOURCE_FILE_ID = "3602650a-4fe4-423c-85a2-af76c083e3c4"
TENANT_ID = "tenant-1"
USER_ID = "user-1"


@dataclass(frozen=True)
class FileDatabase:
    session: Session
    upload_file: UploadFile
    tool_file: ToolFile
    datasource_upload_file: UploadFile
    statements: list[str]


@pytest.fixture(autouse=True)
def file_database(monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine) -> Iterator[FileDatabase]:
    """Persist file records and bind remote-fetcher sessions to SQLite."""
    UploadFile.metadata.create_all(sqlite_engine, tables=[UploadFile.__table__, ToolFile.__table__])
    sqlite_session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    monkeypatch.setattr("core.db.session_factory._session_maker", sqlite_session_maker)

    upload_file = UploadFile(
        tenant_id=TENANT_ID,
        storage_type=StorageType.LOCAL,
        key="upload_files/tenant/hello.txt",
        name="hello.txt",
        size=5,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=USER_ID,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        used=False,
    )
    upload_file.id = UPLOAD_FILE_ID
    tool_file = ToolFile(
        user_id=USER_ID,
        tenant_id=TENANT_ID,
        conversation_id=None,
        file_key="tools/tenant/result.txt",
        mimetype="text/plain",
        name="result.txt",
        size=6,
    )
    tool_file.id = TOOL_FILE_ID
    datasource_upload_file = UploadFile(
        tenant_id=TENANT_ID,
        storage_type=StorageType.LOCAL,
        key="datasources/tenant/data.txt",
        name="data.txt",
        size=4,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=USER_ID,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        used=False,
    )
    datasource_upload_file.id = DATASOURCE_FILE_ID

    statements: list[str] = []

    def record_statement(_connection, _cursor, statement, _parameters, _context, _executemany) -> None:
        statements.append(statement)

    with sqlite_session_maker() as session:
        session.add_all([upload_file, tool_file, datasource_upload_file])
        session.commit()
        event.listen(sqlite_engine, "before_cursor_execute", record_statement)
        try:
            yield FileDatabase(
                session=session,
                upload_file=upload_file,
                tool_file=tool_file,
                datasource_upload_file=datasource_upload_file,
                statements=statements,
            )
        finally:
            event.remove(sqlite_engine, "before_cursor_execute", record_statement)


def _signed_url(*, base_url: str, path: str, payload: str, secret: str = "test-secret") -> str:
    timestamp = "1700000000"
    nonce = "nonce"
    signature = hmac.new(
        secret.encode(),
        f"{payload}|{timestamp}|{nonce}".encode(),
        hashlib.sha256,
    ).digest()
    query = urllib.parse.urlencode(
        {
            "timestamp": timestamp,
            "nonce": nonce,
            "sign": base64.urlsafe_b64encode(signature).decode(),
        }
    )
    return f"{base_url}{path}?{query}"


def _patch_file_fetcher_config(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(remote_fetcher.dify_config, "FILES_URL", "http://localhost:5001")
    monkeypatch.setattr(remote_fetcher.dify_config, "INTERNAL_FILES_URL", "http://api:5001")
    monkeypatch.setattr(remote_fetcher.dify_config, "SECRET_KEY", "test-secret")
    monkeypatch.setattr(remote_fetcher.dify_config, "FILES_ACCESS_TIMEOUT", 3600)
    monkeypatch.setattr(remote_fetcher.time, "time", lambda: 1700000100)


def _patch_ssrf_make_request(monkeypatch: pytest.MonkeyPatch, response=None):
    make_request = MagicMock(return_value=response) if response is not None else MagicMock()
    monkeypatch.setattr(remote_fetcher.ssrf_proxy, "make_request", make_request)
    return make_request


def _patch_signer_times(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("core.datasource.datasource_file_manager.time.time", lambda: 1700000000)
    monkeypatch.setattr("core.tools.signature.time.time", lambda: 1700000000)
    monkeypatch.setattr("core.tools.tool_file_manager.time.time", lambda: 1700000000)


def test_get_signed_upload_file_url_reads_storage_without_ssrf(monkeypatch: pytest.MonkeyPatch):
    _patch_file_fetcher_config(monkeypatch)
    load_once = MagicMock(return_value=b"hello")
    monkeypatch.setattr(remote_fetcher.storage, "load_once", load_once)
    ssrf_make_request = _patch_ssrf_make_request(monkeypatch)
    url = _signed_url(
        base_url="http://localhost:5001",
        path=f"/files/{UPLOAD_FILE_ID}/file-preview",
        payload=f"file-preview|{UPLOAD_FILE_ID}",
    )

    response = remote_fetcher.make_request("GET", url)

    assert response.status_code == 200
    assert response.content == b"hello"
    assert response.headers["Content-Type"] == "text/plain"
    assert response.headers["Content-Length"] == "5"
    assert response.request.method == "GET"
    load_once.assert_called_once_with("upload_files/tenant/hello.txt")
    ssrf_make_request.assert_not_called()


def test_make_request_resolves_upload_preview_url_generated_by_signer(
    monkeypatch: pytest.MonkeyPatch, file_database: FileDatabase
):
    _patch_file_fetcher_config(monkeypatch)
    _patch_signer_times(monkeypatch)
    file_database.upload_file.key = "upload_files/tenant/image.png"
    file_database.upload_file.name = "image.png"
    file_database.upload_file.mime_type = "image/png"
    file_database.upload_file.size = 6
    file_database.upload_file.extension = "png"
    file_database.session.commit()
    load_once = MagicMock(return_value=b"image!")
    monkeypatch.setattr(remote_fetcher.storage, "load_once", load_once)
    ssrf_make_request = MagicMock()
    monkeypatch.setattr(remote_fetcher.ssrf_proxy, "make_request", ssrf_make_request)
    url = sign_upload_file_preview_url(UPLOAD_FILE_ID, ".png")

    response = remote_fetcher.make_request("GET", url)

    assert response.status_code == 200
    assert response.content == b"image!"
    assert response.headers["Content-Type"] == "image/png"
    load_once.assert_called_once_with("upload_files/tenant/image.png")
    ssrf_make_request.assert_not_called()


def test_make_request_resolves_sign_tool_file_url_with_empty_extension(
    monkeypatch: pytest.MonkeyPatch, file_database: FileDatabase
):
    _patch_file_fetcher_config(monkeypatch)
    _patch_signer_times(monkeypatch)
    file_database.tool_file.file_key = "tools/tenant/no-extension"
    file_database.tool_file.name = "no-extension"
    file_database.tool_file.mimetype = "application/octet-stream"
    file_database.tool_file.size = 8
    file_database.session.commit()
    load_once = MagicMock(return_value=b"tooldata")
    monkeypatch.setattr(remote_fetcher.storage, "load_once", load_once)
    ssrf_make_request = MagicMock()
    monkeypatch.setattr(remote_fetcher.ssrf_proxy, "make_request", ssrf_make_request)
    url = sign_tool_file(TOOL_FILE_ID, "", for_external=True)

    response = remote_fetcher.make_request("GET", url)

    assert response.status_code == 200
    assert response.content == b"tooldata"
    assert response.headers["Content-Type"] == "application/octet-stream"
    load_once.assert_called_once_with("tools/tenant/no-extension")
    ssrf_make_request.assert_not_called()


def test_make_request_resolves_tool_manager_url_with_empty_extension(
    monkeypatch: pytest.MonkeyPatch, file_database: FileDatabase
):
    _patch_file_fetcher_config(monkeypatch)
    _patch_signer_times(monkeypatch)
    file_database.tool_file.file_key = "tools/tenant/manager-file"
    file_database.tool_file.name = "manager-file"
    file_database.tool_file.mimetype = "application/octet-stream"
    file_database.tool_file.size = 12
    file_database.session.commit()
    load_once = MagicMock(return_value=b"manager-data")
    monkeypatch.setattr(remote_fetcher.storage, "load_once", load_once)
    ssrf_make_request = MagicMock()
    monkeypatch.setattr(remote_fetcher.ssrf_proxy, "make_request", ssrf_make_request)
    url = ToolFileManager.sign_file(TOOL_FILE_ID, "")

    response = remote_fetcher.make_request("GET", url)

    assert response.status_code == 200
    assert response.content == b"manager-data"
    load_once.assert_called_once_with("tools/tenant/manager-file")
    ssrf_make_request.assert_not_called()


def test_make_request_resolves_datasource_manager_url_with_empty_extension(
    monkeypatch: pytest.MonkeyPatch, file_database: FileDatabase
):
    _patch_file_fetcher_config(monkeypatch)
    _patch_signer_times(monkeypatch)
    file_database.datasource_upload_file.key = "datasources/tenant/no-extension"
    file_database.datasource_upload_file.name = "no-extension"
    file_database.datasource_upload_file.mime_type = "application/octet-stream"
    file_database.datasource_upload_file.size = 10
    file_database.datasource_upload_file.extension = ""
    file_database.session.commit()
    load_once = MagicMock(return_value=b"datasource")
    monkeypatch.setattr(remote_fetcher.storage, "load_once", load_once)
    ssrf_make_request = MagicMock()
    monkeypatch.setattr(remote_fetcher.ssrf_proxy, "make_request", ssrf_make_request)
    url = DatasourceFileManager.sign_file(DATASOURCE_FILE_ID, "")

    response = remote_fetcher.make_request("GET", url)

    assert response.status_code == 200
    assert response.content == b"datasource"
    assert response.headers["Content-Type"] == "application/octet-stream"
    load_once.assert_called_once_with("datasources/tenant/no-extension")
    ssrf_make_request.assert_not_called()


def test_head_signed_upload_file_url_returns_metadata_without_storage_content(monkeypatch: pytest.MonkeyPatch):
    _patch_file_fetcher_config(monkeypatch)
    load_once = MagicMock(return_value=b"hello")
    monkeypatch.setattr(remote_fetcher.storage, "load_once", load_once)
    ssrf_make_request = _patch_ssrf_make_request(monkeypatch)
    url = _signed_url(
        base_url="http://localhost:5001",
        path=f"/files/{UPLOAD_FILE_ID}/file-preview",
        payload=f"file-preview|{UPLOAD_FILE_ID}",
    )

    response = remote_fetcher.make_request("HEAD", url)

    assert response.status_code == 200
    assert response.content == b""
    assert response.headers["Content-Type"] == "text/plain"
    assert response.headers["Content-Length"] == "5"
    assert response.request.method == "HEAD"
    load_once.assert_not_called()
    ssrf_make_request.assert_not_called()


def test_make_request_get_signed_upload_file_url_reads_storage_without_ssrf(monkeypatch: pytest.MonkeyPatch):
    _patch_file_fetcher_config(monkeypatch)
    load_once = MagicMock(return_value=b"hello")
    monkeypatch.setattr(remote_fetcher.storage, "load_once", load_once)
    ssrf_make_request = _patch_ssrf_make_request(monkeypatch)
    url = _signed_url(
        base_url="http://localhost:5001",
        path=f"/files/{UPLOAD_FILE_ID}/file-preview",
        payload=f"file-preview|{UPLOAD_FILE_ID}",
    )

    response = remote_fetcher.make_request("GET", url)

    assert response.status_code == 200
    assert response.content == b"hello"
    assert response.request.method == "GET"
    load_once.assert_called_once_with("upload_files/tenant/hello.txt")
    ssrf_make_request.assert_not_called()


def test_make_request_head_signed_upload_file_url_returns_metadata_without_ssrf(monkeypatch: pytest.MonkeyPatch):
    _patch_file_fetcher_config(monkeypatch)
    load_once = MagicMock(return_value=b"hello")
    monkeypatch.setattr(remote_fetcher.storage, "load_once", load_once)
    ssrf_make_request = _patch_ssrf_make_request(monkeypatch)
    url = _signed_url(
        base_url="http://localhost:5001",
        path=f"/files/{UPLOAD_FILE_ID}/file-preview",
        payload=f"file-preview|{UPLOAD_FILE_ID}",
    )

    response = remote_fetcher.make_request("HEAD", url)

    assert response.status_code == 200
    assert response.content == b""
    assert response.headers["Content-Type"] == "text/plain"
    assert response.headers["Content-Length"] == "5"
    assert response.request.method == "HEAD"
    load_once.assert_not_called()
    ssrf_make_request.assert_not_called()


def test_make_request_get_unsigned_dify_url_delegates_to_ssrf_proxy(
    monkeypatch: pytest.MonkeyPatch, file_database: FileDatabase
):
    _patch_file_fetcher_config(monkeypatch)
    url = f"http://localhost:5001/files/{UPLOAD_FILE_ID}/file-preview?timestamp=1700000000&nonce=nonce"
    proxy_response = httpx.Response(403, request=httpx.Request("GET", url))
    ssrf_make_request = _patch_ssrf_make_request(monkeypatch, proxy_response)

    response = remote_fetcher.make_request("GET", url, timeout=3)

    assert response is proxy_response
    assert file_database.statements == []
    ssrf_make_request.assert_called_once_with(
        method="GET",
        url=url,
        max_retries=remote_fetcher.SSRF_DEFAULT_MAX_RETRIES,
        timeout=3,
    )


def test_make_request_post_signed_upload_file_url_delegates_to_ssrf_proxy(
    monkeypatch: pytest.MonkeyPatch, file_database: FileDatabase
):
    _patch_file_fetcher_config(monkeypatch)
    proxy_response = httpx.Response(201, request=httpx.Request("POST", f"http://localhost:5001/files/{UPLOAD_FILE_ID}"))
    ssrf_make_request = _patch_ssrf_make_request(monkeypatch, proxy_response)
    url = _signed_url(
        base_url="http://localhost:5001",
        path=f"/files/{UPLOAD_FILE_ID}/file-preview",
        payload=f"file-preview|{UPLOAD_FILE_ID}",
    )

    response = remote_fetcher.make_request("POST", url, json={"name": "ignored"})

    assert response is proxy_response
    assert file_database.statements == []
    ssrf_make_request.assert_called_once_with(
        method="POST",
        url=url,
        max_retries=remote_fetcher.SSRF_DEFAULT_MAX_RETRIES,
        json={"name": "ignored"},
    )


def test_get_signed_image_preview_url_uses_image_preview_signature(
    monkeypatch: pytest.MonkeyPatch, file_database: FileDatabase
):
    _patch_file_fetcher_config(monkeypatch)
    file_database.upload_file.key = "upload_files/tenant/image.png"
    file_database.upload_file.name = "image.png"
    file_database.upload_file.mime_type = "image/png"
    file_database.upload_file.size = 6
    file_database.upload_file.extension = "png"
    file_database.session.commit()
    load_once = MagicMock(return_value=b"image!")
    monkeypatch.setattr(remote_fetcher.storage, "load_once", load_once)
    ssrf_make_request = _patch_ssrf_make_request(monkeypatch)
    url = _signed_url(
        base_url="http://localhost:5001",
        path=f"/files/{UPLOAD_FILE_ID}/image-preview",
        payload=f"image-preview|{UPLOAD_FILE_ID}",
    )

    response = remote_fetcher.make_request("GET", url)

    assert response.status_code == 200
    assert response.content == b"image!"
    assert response.headers["Content-Type"] == "image/png"
    load_once.assert_called_once_with("upload_files/tenant/image.png")
    ssrf_make_request.assert_not_called()


def test_image_preview_url_with_file_preview_signature_delegates_to_ssrf_proxy(monkeypatch: pytest.MonkeyPatch):
    _patch_file_fetcher_config(monkeypatch)
    proxy_response = httpx.Response(403, request=httpx.Request("GET", "http://localhost:5001/bad"))
    ssrf_make_request = _patch_ssrf_make_request(monkeypatch, proxy_response)
    url = _signed_url(
        base_url="http://localhost:5001",
        path=f"/files/{UPLOAD_FILE_ID}/image-preview",
        payload=f"file-preview|{UPLOAD_FILE_ID}",
    )

    response = remote_fetcher.make_request("GET", url)

    assert response is proxy_response
    ssrf_make_request.assert_called_once_with(
        method="GET",
        url=url,
        max_retries=remote_fetcher.SSRF_DEFAULT_MAX_RETRIES,
    )


def test_duplicate_signature_query_value_delegates_to_ssrf_proxy(monkeypatch: pytest.MonkeyPatch):
    _patch_file_fetcher_config(monkeypatch)
    url = (
        _signed_url(
            base_url="http://localhost:5001",
            path=f"/files/{UPLOAD_FILE_ID}/file-preview",
            payload=f"file-preview|{UPLOAD_FILE_ID}",
        )
        + "&sign=second"
    )
    proxy_response = httpx.Response(403, request=httpx.Request("GET", url))
    ssrf_make_request = _patch_ssrf_make_request(monkeypatch, proxy_response)

    response = remote_fetcher.make_request("GET", url)

    assert response is proxy_response
    ssrf_make_request.assert_called_once_with(
        method="GET",
        url=url,
        max_retries=remote_fetcher.SSRF_DEFAULT_MAX_RETRIES,
    )


def test_malformed_timestamp_delegates_to_ssrf_proxy(monkeypatch: pytest.MonkeyPatch):
    _patch_file_fetcher_config(monkeypatch)
    url = _signed_url(
        base_url="http://localhost:5001",
        path=f"/files/{UPLOAD_FILE_ID}/file-preview",
        payload=f"file-preview|{UPLOAD_FILE_ID}",
    ).replace("timestamp=1700000000", "timestamp=not-an-int")
    proxy_response = httpx.Response(403, request=httpx.Request("GET", url))
    ssrf_make_request = _patch_ssrf_make_request(monkeypatch, proxy_response)

    response = remote_fetcher.make_request("GET", url)

    assert response is proxy_response
    ssrf_make_request.assert_called_once_with(
        method="GET",
        url=url,
        max_retries=remote_fetcher.SSRF_DEFAULT_MAX_RETRIES,
    )


def test_expired_signature_delegates_to_ssrf_proxy(monkeypatch: pytest.MonkeyPatch):
    _patch_file_fetcher_config(monkeypatch)
    monkeypatch.setattr(remote_fetcher.time, "time", lambda: 1700004001)
    url = _signed_url(
        base_url="http://localhost:5001",
        path=f"/files/{UPLOAD_FILE_ID}/file-preview",
        payload=f"file-preview|{UPLOAD_FILE_ID}",
    )
    proxy_response = httpx.Response(403, request=httpx.Request("GET", url))
    ssrf_make_request = _patch_ssrf_make_request(monkeypatch, proxy_response)

    response = remote_fetcher.make_request("GET", url)

    assert response is proxy_response
    ssrf_make_request.assert_called_once_with(
        method="GET",
        url=url,
        max_retries=remote_fetcher.SSRF_DEFAULT_MAX_RETRIES,
    )


def test_invalid_signature_delegates_to_ssrf_proxy(monkeypatch: pytest.MonkeyPatch):
    _patch_file_fetcher_config(monkeypatch)
    proxy_response = httpx.Response(403, request=httpx.Request("GET", "http://localhost:5001/bad"))
    ssrf_make_request = _patch_ssrf_make_request(monkeypatch, proxy_response)
    url = f"http://localhost:5001/files/{UPLOAD_FILE_ID}/file-preview?timestamp=1700000000&nonce=nonce&sign=bad"

    response = remote_fetcher.make_request("GET", url, timeout=3)

    assert response is proxy_response
    ssrf_make_request.assert_called_once_with(
        method="GET",
        url=url,
        max_retries=remote_fetcher.SSRF_DEFAULT_MAX_RETRIES,
        timeout=3,
    )


def test_host_mismatch_delegates_to_ssrf_proxy(monkeypatch: pytest.MonkeyPatch):
    _patch_file_fetcher_config(monkeypatch)
    url = _signed_url(
        base_url="http://example.com",
        path=f"/files/{UPLOAD_FILE_ID}/file-preview",
        payload=f"file-preview|{UPLOAD_FILE_ID}",
    )
    proxy_response = httpx.Response(200, request=httpx.Request("GET", url), content=b"remote")
    ssrf_make_request = _patch_ssrf_make_request(monkeypatch, proxy_response)

    response = remote_fetcher.make_request("GET", url)

    assert response is proxy_response
    ssrf_make_request.assert_called_once_with(
        method="GET",
        url=url,
        max_retries=remote_fetcher.SSRF_DEFAULT_MAX_RETRIES,
    )


def test_unsupported_dify_path_delegates_to_ssrf_proxy(monkeypatch: pytest.MonkeyPatch):
    _patch_file_fetcher_config(monkeypatch)
    url = _signed_url(
        base_url="http://localhost:5001",
        path=f"/files/{UPLOAD_FILE_ID}/not-preview",
        payload=f"file-preview|{UPLOAD_FILE_ID}",
    )
    proxy_response = httpx.Response(404, request=httpx.Request("HEAD", url))
    ssrf_make_request = _patch_ssrf_make_request(monkeypatch, proxy_response)

    response = remote_fetcher.make_request("HEAD", url, follow_redirects=True)

    assert response is proxy_response
    ssrf_make_request.assert_called_once_with(
        method="HEAD",
        url=url,
        max_retries=remote_fetcher.SSRF_DEFAULT_MAX_RETRIES,
        follow_redirects=True,
    )


def test_invalid_url_scheme_delegates_to_ssrf_proxy(monkeypatch: pytest.MonkeyPatch):
    _patch_file_fetcher_config(monkeypatch)
    url = f"file:///tmp/files/{UPLOAD_FILE_ID}/file-preview?timestamp=1700000000&nonce=nonce&sign=ignored"
    proxy_response = httpx.Response(403, request=httpx.Request("GET", url))
    ssrf_make_request = _patch_ssrf_make_request(monkeypatch, proxy_response)

    response = remote_fetcher.make_request("GET", url)

    assert response is proxy_response
    ssrf_make_request.assert_called_once_with(
        method="GET",
        url=url,
        max_retries=remote_fetcher.SSRF_DEFAULT_MAX_RETRIES,
    )


def test_invalid_url_port_delegates_to_ssrf_proxy(monkeypatch: pytest.MonkeyPatch):
    _patch_file_fetcher_config(monkeypatch)
    url = f"http://localhost:invalid/files/{UPLOAD_FILE_ID}/file-preview?timestamp=1700000000&nonce=nonce&sign=ignored"
    proxy_response = httpx.Response(403, request=httpx.Request("GET", "http://proxy.example/fallback"))
    ssrf_make_request = _patch_ssrf_make_request(monkeypatch, proxy_response)

    response = remote_fetcher.make_request("GET", url)

    assert response is proxy_response
    ssrf_make_request.assert_called_once_with(
        method="GET",
        url=url,
        max_retries=remote_fetcher.SSRF_DEFAULT_MAX_RETRIES,
    )


def test_invalid_configured_file_origin_delegates_to_ssrf_proxy(monkeypatch: pytest.MonkeyPatch):
    _patch_file_fetcher_config(monkeypatch)
    monkeypatch.setattr(remote_fetcher.dify_config, "FILES_URL", "")
    monkeypatch.setattr(remote_fetcher.dify_config, "INTERNAL_FILES_URL", "file:///tmp/files")
    url = _signed_url(
        base_url="http://localhost:5001",
        path=f"/files/{UPLOAD_FILE_ID}/file-preview",
        payload=f"file-preview|{UPLOAD_FILE_ID}",
    )
    proxy_response = httpx.Response(403, request=httpx.Request("GET", url))
    ssrf_make_request = _patch_ssrf_make_request(monkeypatch, proxy_response)

    response = remote_fetcher.make_request("GET", url)

    assert response is proxy_response
    ssrf_make_request.assert_called_once_with(
        method="GET",
        url=url,
        max_retries=remote_fetcher.SSRF_DEFAULT_MAX_RETRIES,
    )


def test_signed_upload_file_url_returns_404_when_record_missing(
    monkeypatch: pytest.MonkeyPatch, file_database: FileDatabase
):
    _patch_file_fetcher_config(monkeypatch)
    file_database.session.delete(file_database.upload_file)
    file_database.session.commit()
    ssrf_make_request = _patch_ssrf_make_request(monkeypatch)
    url = _signed_url(
        base_url="http://localhost:5001",
        path=f"/files/{UPLOAD_FILE_ID}/file-preview",
        payload=f"file-preview|{UPLOAD_FILE_ID}",
    )

    response = remote_fetcher.make_request("GET", url)

    assert response.status_code == 404
    assert response.content == b""
    ssrf_make_request.assert_not_called()


def test_get_signed_tool_file_url_reads_storage_without_ssrf(monkeypatch: pytest.MonkeyPatch):
    _patch_file_fetcher_config(monkeypatch)
    load_once = MagicMock(return_value=b"result")
    monkeypatch.setattr(remote_fetcher.storage, "load_once", load_once)
    ssrf_make_request = _patch_ssrf_make_request(monkeypatch)
    url = _signed_url(
        base_url="http://localhost:5001",
        path=f"/files/tools/{TOOL_FILE_ID}.txt",
        payload=f"file-preview|{TOOL_FILE_ID}",
    )

    response = remote_fetcher.make_request("GET", url)

    assert response.status_code == 200
    assert response.content == b"result"
    assert response.headers["Content-Type"] == "text/plain"
    load_once.assert_called_once_with("tools/tenant/result.txt")
    ssrf_make_request.assert_not_called()


def test_signed_tool_file_url_returns_404_when_record_missing(
    monkeypatch: pytest.MonkeyPatch, file_database: FileDatabase
):
    _patch_file_fetcher_config(monkeypatch)
    file_database.session.delete(file_database.tool_file)
    file_database.session.commit()
    ssrf_make_request = _patch_ssrf_make_request(monkeypatch)
    url = _signed_url(
        base_url="http://localhost:5001",
        path=f"/files/tools/{TOOL_FILE_ID}.txt",
        payload=f"file-preview|{TOOL_FILE_ID}",
    )

    response = remote_fetcher.make_request("GET", url)

    assert response.status_code == 404
    assert response.content == b""
    ssrf_make_request.assert_not_called()


def test_get_signed_datasource_file_url_reads_upload_storage_without_ssrf(monkeypatch: pytest.MonkeyPatch):
    _patch_file_fetcher_config(monkeypatch)
    load_once = MagicMock(return_value=b"data")
    monkeypatch.setattr(remote_fetcher.storage, "load_once", load_once)
    ssrf_make_request = _patch_ssrf_make_request(monkeypatch)
    url = _signed_url(
        base_url="http://localhost:5001",
        path=f"/files/datasources/{DATASOURCE_FILE_ID}.txt",
        payload=f"file-preview|{DATASOURCE_FILE_ID}",
    )

    response = remote_fetcher.make_request("GET", url)

    assert response.status_code == 200
    assert response.content == b"data"
    load_once.assert_called_once_with("datasources/tenant/data.txt")
    ssrf_make_request.assert_not_called()


def test_get_signed_datasource_file_url_reads_tool_storage_when_upload_missing(
    monkeypatch: pytest.MonkeyPatch, file_database: FileDatabase
):
    _patch_file_fetcher_config(monkeypatch)
    file_database.session.delete(file_database.datasource_upload_file)
    datasource_tool_file = ToolFile(
        user_id=USER_ID,
        tenant_id=TENANT_ID,
        conversation_id=None,
        file_key="datasources/tenant/tool-data.txt",
        name="tool-data.txt",
        mimetype="text/plain",
        size=9,
    )
    datasource_tool_file.id = DATASOURCE_FILE_ID
    file_database.session.add(datasource_tool_file)
    file_database.session.commit()
    load_once = MagicMock(return_value=b"tool-data")
    monkeypatch.setattr(remote_fetcher.storage, "load_once", load_once)
    ssrf_make_request = _patch_ssrf_make_request(monkeypatch)
    url = _signed_url(
        base_url="http://localhost:5001",
        path=f"/files/datasources/{DATASOURCE_FILE_ID}.txt",
        payload=f"file-preview|{DATASOURCE_FILE_ID}",
    )

    response = remote_fetcher.make_request("GET", url)

    assert response.status_code == 200
    assert response.content == b"tool-data"
    assert response.headers["Content-Type"] == "text/plain"
    assert response.headers["Content-Length"] == "9"
    load_once.assert_called_once_with("datasources/tenant/tool-data.txt")
    ssrf_make_request.assert_not_called()


def test_signed_datasource_file_url_returns_404_when_records_missing(
    monkeypatch: pytest.MonkeyPatch, file_database: FileDatabase
):
    _patch_file_fetcher_config(monkeypatch)
    file_database.session.delete(file_database.datasource_upload_file)
    file_database.session.commit()
    ssrf_make_request = _patch_ssrf_make_request(monkeypatch)
    url = _signed_url(
        base_url="http://localhost:5001",
        path=f"/files/datasources/{DATASOURCE_FILE_ID}.txt",
        payload=f"file-preview|{DATASOURCE_FILE_ID}",
    )

    response = remote_fetcher.make_request("GET", url)

    assert response.status_code == 404
    assert response.content == b""
    ssrf_make_request.assert_not_called()


@pytest.mark.parametrize("method_name", ["POST", "PUT", "DELETE", "PATCH"])
def test_non_get_make_request_methods_delegate_to_ssrf_proxy(monkeypatch, method_name):
    url = "https://example.com/file.txt"
    proxy_response = httpx.Response(200, request=httpx.Request(method_name, url))
    ssrf_make_request = _patch_ssrf_make_request(monkeypatch, proxy_response)

    response = remote_fetcher.make_request(method_name, url, max_retries=2, timeout=3)

    assert response is proxy_response
    ssrf_make_request.assert_called_once_with(method=method_name, url=url, max_retries=2, timeout=3)


def test_graphon_remote_file_fetcher_exposes_ssrf_error_types():
    fetcher = remote_fetcher.GraphonRemoteFileFetcher()

    assert fetcher.max_retries_exceeded_error is remote_fetcher.max_retries_exceeded_error
    assert fetcher.request_error is remote_fetcher.request_error


@pytest.mark.parametrize("method_name", ["get", "head", "post", "put", "delete", "patch"])
def test_graphon_remote_file_fetcher_adapts_fetcher_responses(monkeypatch, method_name):
    url = "https://example.com/file.txt"
    response = httpx.Response(200, request=httpx.Request(method_name.upper(), url), content=b"ok")
    make_request = MagicMock(return_value=response)
    graphon_response = object()
    adapter = MagicMock(return_value=graphon_response)
    monkeypatch.setattr(remote_fetcher, "make_request", make_request)
    monkeypatch.setattr(remote_fetcher, "_to_graphon_http_response", adapter)

    result = getattr(remote_fetcher.GraphonRemoteFileFetcher(), method_name)(url, max_retries=2, timeout=3)

    assert result is graphon_response
    make_request.assert_called_once_with(method_name.upper(), url=url, max_retries=2, timeout=3)
    adapter.assert_called_once_with(response)
