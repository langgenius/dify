from unittest.mock import MagicMock

import httpx

from models import Account
from services import app_dsl_service
from services.app_dsl_service import AppDslService, ImportMode, ImportStatus


def _build_response(url: str, status_code: int, content: bytes = b"") -> httpx.Response:
    request = httpx.Request("GET", url)
    return httpx.Response(status_code=status_code, request=request, content=content)


def _pending_yaml_content(version: str = "99.0.0") -> bytes:
    return (f'version: "{version}"\nkind: app\napp:\n  name: Loop Test\n  mode: workflow\n').encode()


def _account_mock() -> MagicMock:
    account = MagicMock(spec=Account)
    account.current_tenant_id = "tenant-1"
    return account


def test_import_app_yaml_url_user_attachments_keeps_original_url(monkeypatch):
    yaml_url = "https://github.com/user-attachments/files/24290802/loop-test.yml"
    raw_url = "https://raw.githubusercontent.com/user-attachments/files/24290802/loop-test.yml"
    yaml_bytes = _pending_yaml_content()

    def fake_get(url: str, **kwargs):
        if url == raw_url:
            return _build_response(url, status_code=404)
        assert url == yaml_url
        return _build_response(url, status_code=200, content=yaml_bytes)

    monkeypatch.setattr(app_dsl_service.ssrf_proxy, "get", fake_get)

    service = AppDslService(MagicMock())
    result = service.import_app(
        account=_account_mock(),
        import_mode=ImportMode.YAML_URL,
        yaml_url=yaml_url,
    )

    assert result.status == ImportStatus.PENDING
    assert result.imported_dsl_version == "99.0.0"


def test_import_app_yaml_url_github_blob_rewrites_to_raw(monkeypatch):
    yaml_url = "https://github.com/acme/repo/blob/main/app.yml"
    raw_url = "https://raw.githubusercontent.com/acme/repo/main/app.yml"
    yaml_bytes = _pending_yaml_content()

    requested_urls: list[str] = []

    def fake_get(url: str, **kwargs):
        requested_urls.append(url)
        assert url == raw_url
        return _build_response(url, status_code=200, content=yaml_bytes)

    monkeypatch.setattr(app_dsl_service.ssrf_proxy, "get", fake_get)

    service = AppDslService(MagicMock())
    result = service.import_app(
        account=_account_mock(),
        import_mode=ImportMode.YAML_URL,
        yaml_url=yaml_url,
    )

    assert result.status == ImportStatus.PENDING
    assert requested_urls == [raw_url]
