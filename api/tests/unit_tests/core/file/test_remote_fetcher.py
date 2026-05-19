import base64
import hashlib
import hmac
import urllib.parse
from types import SimpleNamespace
from unittest.mock import MagicMock

import httpx

from core.file import remote_fetcher

UPLOAD_FILE_ID = "1602650a-4fe4-423c-85a2-af76c083e3c4"
TOOL_FILE_ID = "2602650a-4fe4-423c-85a2-af76c083e3c4"
DATASOURCE_FILE_ID = "3602650a-4fe4-423c-85a2-af76c083e3c4"


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


def _patch_file_fetcher_config(monkeypatch):
    monkeypatch.setattr(remote_fetcher.dify_config, "FILES_URL", "http://localhost:5001")
    monkeypatch.setattr(remote_fetcher.dify_config, "INTERNAL_FILES_URL", "http://api:5001")
    monkeypatch.setattr(remote_fetcher.dify_config, "SECRET_KEY", "test-secret")
    monkeypatch.setattr(remote_fetcher.dify_config, "FILES_ACCESS_TIMEOUT", 3600)
    monkeypatch.setattr(remote_fetcher.time, "time", lambda: 1700000100)


def _patch_session(monkeypatch):
    session = MagicMock()
    session_cm = MagicMock()
    session_cm.__enter__.return_value = session
    session_cm.__exit__.return_value = False
    monkeypatch.setattr(remote_fetcher.session_factory, "create_session", MagicMock(return_value=session_cm))
    return session


def test_get_signed_upload_file_url_reads_storage_without_ssrf(monkeypatch):
    _patch_file_fetcher_config(monkeypatch)
    session = _patch_session(monkeypatch)
    upload_file = SimpleNamespace(
        id=UPLOAD_FILE_ID,
        key="upload_files/tenant/hello.txt",
        name="hello.txt",
        mime_type="text/plain",
        size=5,
        extension="txt",
    )
    monkeypatch.setattr(remote_fetcher._file_access_controller, "get_upload_file", MagicMock(return_value=upload_file))
    monkeypatch.setattr(remote_fetcher.storage, "load_once", MagicMock(return_value=b"hello"))
    ssrf_get = MagicMock()
    monkeypatch.setattr(remote_fetcher.ssrf_proxy, "get", ssrf_get)
    url = _signed_url(
        base_url="http://localhost:5001",
        path=f"/files/{UPLOAD_FILE_ID}/file-preview",
        payload=f"file-preview|{UPLOAD_FILE_ID}",
    )

    response = remote_fetcher.get(url)

    assert response.status_code == 200
    assert response.content == b"hello"
    assert response.headers["Content-Type"] == "text/plain"
    assert response.headers["Content-Length"] == "5"
    assert response.request.method == "GET"
    remote_fetcher._file_access_controller.get_upload_file.assert_called_once_with(
        session=session,
        file_id=UPLOAD_FILE_ID,
    )
    remote_fetcher.storage.load_once.assert_called_once_with("upload_files/tenant/hello.txt")
    ssrf_get.assert_not_called()


def test_head_signed_upload_file_url_returns_metadata_without_storage_content(monkeypatch):
    _patch_file_fetcher_config(monkeypatch)
    session = _patch_session(monkeypatch)
    upload_file = SimpleNamespace(
        id=UPLOAD_FILE_ID,
        key="upload_files/tenant/hello.txt",
        name="hello.txt",
        mime_type="text/plain",
        size=5,
        extension="txt",
    )
    monkeypatch.setattr(remote_fetcher._file_access_controller, "get_upload_file", MagicMock(return_value=upload_file))
    load_once = MagicMock(return_value=b"hello")
    monkeypatch.setattr(remote_fetcher.storage, "load_once", load_once)
    ssrf_head = MagicMock()
    monkeypatch.setattr(remote_fetcher.ssrf_proxy, "head", ssrf_head)
    url = _signed_url(
        base_url="http://localhost:5001",
        path=f"/files/{UPLOAD_FILE_ID}/file-preview",
        payload=f"file-preview|{UPLOAD_FILE_ID}",
    )

    response = remote_fetcher.head(url)

    assert response.status_code == 200
    assert response.content == b""
    assert response.headers["Content-Type"] == "text/plain"
    assert response.headers["Content-Length"] == "5"
    assert response.request.method == "HEAD"
    remote_fetcher._file_access_controller.get_upload_file.assert_called_once_with(
        session=session,
        file_id=UPLOAD_FILE_ID,
    )
    load_once.assert_not_called()
    ssrf_head.assert_not_called()


def test_make_request_get_signed_upload_file_url_reads_storage_without_ssrf(monkeypatch):
    _patch_file_fetcher_config(monkeypatch)
    _patch_session(monkeypatch)
    upload_file = SimpleNamespace(
        id=UPLOAD_FILE_ID,
        key="upload_files/tenant/hello.txt",
        name="hello.txt",
        mime_type="text/plain",
        size=5,
        extension="txt",
    )
    monkeypatch.setattr(remote_fetcher._file_access_controller, "get_upload_file", MagicMock(return_value=upload_file))
    monkeypatch.setattr(remote_fetcher.storage, "load_once", MagicMock(return_value=b"hello"))
    ssrf_make_request = MagicMock()
    monkeypatch.setattr(remote_fetcher.ssrf_proxy, "make_request", ssrf_make_request)
    url = _signed_url(
        base_url="http://localhost:5001",
        path=f"/files/{UPLOAD_FILE_ID}/file-preview",
        payload=f"file-preview|{UPLOAD_FILE_ID}",
    )

    response = remote_fetcher.make_request("GET", url)

    assert response.status_code == 200
    assert response.content == b"hello"
    assert response.request.method == "GET"
    remote_fetcher.storage.load_once.assert_called_once_with("upload_files/tenant/hello.txt")
    ssrf_make_request.assert_not_called()


def test_make_request_post_signed_upload_file_url_delegates_to_ssrf_proxy(monkeypatch):
    _patch_file_fetcher_config(monkeypatch)
    get_upload_file = MagicMock()
    monkeypatch.setattr(remote_fetcher._file_access_controller, "get_upload_file", get_upload_file)
    proxy_response = httpx.Response(201, request=httpx.Request("POST", f"http://localhost:5001/files/{UPLOAD_FILE_ID}"))
    ssrf_make_request = MagicMock(return_value=proxy_response)
    monkeypatch.setattr(remote_fetcher.ssrf_proxy, "make_request", ssrf_make_request)
    url = _signed_url(
        base_url="http://localhost:5001",
        path=f"/files/{UPLOAD_FILE_ID}/file-preview",
        payload=f"file-preview|{UPLOAD_FILE_ID}",
    )

    response = remote_fetcher.make_request("POST", url, json={"name": "ignored"})

    assert response is proxy_response
    get_upload_file.assert_not_called()
    ssrf_make_request.assert_called_once_with(
        method="POST",
        url=url,
        max_retries=remote_fetcher.SSRF_DEFAULT_MAX_RETRIES,
        json={"name": "ignored"},
    )


def test_get_signed_image_preview_url_uses_image_preview_signature(monkeypatch):
    _patch_file_fetcher_config(monkeypatch)
    _patch_session(monkeypatch)
    upload_file = SimpleNamespace(
        id=UPLOAD_FILE_ID,
        key="upload_files/tenant/image.png",
        name="image.png",
        mime_type="image/png",
        size=6,
        extension="png",
    )
    monkeypatch.setattr(remote_fetcher._file_access_controller, "get_upload_file", MagicMock(return_value=upload_file))
    monkeypatch.setattr(remote_fetcher.storage, "load_once", MagicMock(return_value=b"image!"))
    ssrf_get = MagicMock()
    monkeypatch.setattr(remote_fetcher.ssrf_proxy, "get", ssrf_get)
    url = _signed_url(
        base_url="http://localhost:5001",
        path=f"/files/{UPLOAD_FILE_ID}/image-preview",
        payload=f"image-preview|{UPLOAD_FILE_ID}",
    )

    response = remote_fetcher.get(url)

    assert response.status_code == 200
    assert response.content == b"image!"
    assert response.headers["Content-Type"] == "image/png"
    ssrf_get.assert_not_called()


def test_image_preview_url_with_file_preview_signature_delegates_to_ssrf_proxy(monkeypatch):
    _patch_file_fetcher_config(monkeypatch)
    proxy_response = httpx.Response(403, request=httpx.Request("GET", "http://localhost:5001/bad"))
    ssrf_get = MagicMock(return_value=proxy_response)
    monkeypatch.setattr(remote_fetcher.ssrf_proxy, "get", ssrf_get)
    url = _signed_url(
        base_url="http://localhost:5001",
        path=f"/files/{UPLOAD_FILE_ID}/image-preview",
        payload=f"file-preview|{UPLOAD_FILE_ID}",
    )

    response = remote_fetcher.get(url)

    assert response is proxy_response
    ssrf_get.assert_called_once_with(url=url, max_retries=remote_fetcher.SSRF_DEFAULT_MAX_RETRIES)


def test_invalid_signature_delegates_to_ssrf_proxy(monkeypatch):
    _patch_file_fetcher_config(monkeypatch)
    proxy_response = httpx.Response(403, request=httpx.Request("GET", "http://localhost:5001/bad"))
    ssrf_get = MagicMock(return_value=proxy_response)
    monkeypatch.setattr(remote_fetcher.ssrf_proxy, "get", ssrf_get)
    url = f"http://localhost:5001/files/{UPLOAD_FILE_ID}/file-preview?timestamp=1700000000&nonce=nonce&sign=bad"

    response = remote_fetcher.get(url, timeout=3)

    assert response is proxy_response
    ssrf_get.assert_called_once_with(url=url, max_retries=remote_fetcher.SSRF_DEFAULT_MAX_RETRIES, timeout=3)


def test_host_mismatch_delegates_to_ssrf_proxy(monkeypatch):
    _patch_file_fetcher_config(monkeypatch)
    url = _signed_url(
        base_url="http://example.com",
        path=f"/files/{UPLOAD_FILE_ID}/file-preview",
        payload=f"file-preview|{UPLOAD_FILE_ID}",
    )
    proxy_response = httpx.Response(200, request=httpx.Request("GET", url), content=b"remote")
    ssrf_get = MagicMock(return_value=proxy_response)
    monkeypatch.setattr(remote_fetcher.ssrf_proxy, "get", ssrf_get)

    response = remote_fetcher.get(url)

    assert response is proxy_response
    ssrf_get.assert_called_once_with(url=url, max_retries=remote_fetcher.SSRF_DEFAULT_MAX_RETRIES)


def test_unsupported_dify_path_delegates_to_ssrf_proxy(monkeypatch):
    _patch_file_fetcher_config(monkeypatch)
    url = _signed_url(
        base_url="http://localhost:5001",
        path=f"/files/{UPLOAD_FILE_ID}/not-preview",
        payload=f"file-preview|{UPLOAD_FILE_ID}",
    )
    proxy_response = httpx.Response(404, request=httpx.Request("HEAD", url))
    ssrf_head = MagicMock(return_value=proxy_response)
    monkeypatch.setattr(remote_fetcher.ssrf_proxy, "head", ssrf_head)

    response = remote_fetcher.head(url, follow_redirects=True)

    assert response is proxy_response
    ssrf_head.assert_called_once_with(
        url=url,
        max_retries=remote_fetcher.SSRF_DEFAULT_MAX_RETRIES,
        follow_redirects=True,
    )


def test_signed_upload_file_url_returns_404_when_record_missing(monkeypatch):
    _patch_file_fetcher_config(monkeypatch)
    _patch_session(monkeypatch)
    monkeypatch.setattr(remote_fetcher._file_access_controller, "get_upload_file", MagicMock(return_value=None))
    ssrf_get = MagicMock()
    monkeypatch.setattr(remote_fetcher.ssrf_proxy, "get", ssrf_get)
    url = _signed_url(
        base_url="http://localhost:5001",
        path=f"/files/{UPLOAD_FILE_ID}/file-preview",
        payload=f"file-preview|{UPLOAD_FILE_ID}",
    )

    response = remote_fetcher.get(url)

    assert response.status_code == 404
    assert response.content == b""
    ssrf_get.assert_not_called()


def test_get_signed_tool_file_url_reads_storage_without_ssrf(monkeypatch):
    _patch_file_fetcher_config(monkeypatch)
    session = _patch_session(monkeypatch)
    tool_file = SimpleNamespace(
        id=TOOL_FILE_ID,
        file_key="tools/tenant/result.txt",
        name="result.txt",
        mimetype="text/plain",
        size=6,
    )
    monkeypatch.setattr(remote_fetcher._file_access_controller, "get_tool_file", MagicMock(return_value=tool_file))
    monkeypatch.setattr(remote_fetcher.storage, "load_once", MagicMock(return_value=b"result"))
    ssrf_get = MagicMock()
    monkeypatch.setattr(remote_fetcher.ssrf_proxy, "get", ssrf_get)
    url = _signed_url(
        base_url="http://localhost:5001",
        path=f"/files/tools/{TOOL_FILE_ID}.txt",
        payload=f"file-preview|{TOOL_FILE_ID}",
    )

    response = remote_fetcher.get(url)

    assert response.status_code == 200
    assert response.content == b"result"
    assert response.headers["Content-Type"] == "text/plain"
    remote_fetcher._file_access_controller.get_tool_file.assert_called_once_with(
        session=session,
        file_id=TOOL_FILE_ID,
    )
    remote_fetcher.storage.load_once.assert_called_once_with("tools/tenant/result.txt")
    ssrf_get.assert_not_called()


def test_get_signed_datasource_file_url_reads_upload_storage_without_ssrf(monkeypatch):
    _patch_file_fetcher_config(monkeypatch)
    _patch_session(monkeypatch)
    upload_file = SimpleNamespace(
        id=DATASOURCE_FILE_ID,
        key="datasources/tenant/data.txt",
        name="data.txt",
        mime_type="text/plain",
        size=4,
        extension="txt",
    )
    monkeypatch.setattr(remote_fetcher._file_access_controller, "get_upload_file", MagicMock(return_value=upload_file))
    monkeypatch.setattr(remote_fetcher._file_access_controller, "get_tool_file", MagicMock(return_value=None))
    monkeypatch.setattr(remote_fetcher.storage, "load_once", MagicMock(return_value=b"data"))
    ssrf_get = MagicMock()
    monkeypatch.setattr(remote_fetcher.ssrf_proxy, "get", ssrf_get)
    url = _signed_url(
        base_url="http://localhost:5001",
        path=f"/files/datasources/{DATASOURCE_FILE_ID}.txt",
        payload=f"file-preview|{DATASOURCE_FILE_ID}",
    )

    response = remote_fetcher.get(url)

    assert response.status_code == 200
    assert response.content == b"data"
    remote_fetcher.storage.load_once.assert_called_once_with("datasources/tenant/data.txt")
    ssrf_get.assert_not_called()
