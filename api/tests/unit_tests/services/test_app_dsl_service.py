from types import SimpleNamespace
from unittest.mock import Mock

from services.app_dsl_service import AppDslService, ImportStatus


def test_import_app_rejects_oversized_yaml_content_by_bytes(monkeypatch) -> None:
    monkeypatch.setattr("services.app_dsl_service.DSL_MAX_SIZE", 1)
    service = AppDslService(session=SimpleNamespace())

    result = service.import_app(
        account=SimpleNamespace(current_tenant_id="tenant-1"),
        import_mode="yaml-content",
        yaml_content="é",
    )

    assert result.status == ImportStatus.FAILED
    assert "10MB" in result.error


def test_import_app_rejects_oversized_yaml_url_bytes_before_decode(monkeypatch) -> None:
    monkeypatch.setattr("services.app_dsl_service.DSL_MAX_SIZE", 1)
    response = Mock()
    response.raise_for_status.return_value = None
    response.content = b"\xff\xff"
    monkeypatch.setattr("services.app_dsl_service.remote_fetcher.make_request", Mock(return_value=response))
    service = AppDslService(session=SimpleNamespace())

    result = service.import_app(
        account=SimpleNamespace(current_tenant_id="tenant-1"),
        import_mode="yaml-url",
        yaml_url="https://example.com/app.yaml",
    )

    assert result.status == ImportStatus.FAILED
    assert "10MB" in result.error


def test_import_app_returns_decode_error_for_invalid_yaml_url_bytes(monkeypatch) -> None:
    response = Mock()
    response.raise_for_status.return_value = None
    response.content = b"\xff"
    monkeypatch.setattr("services.app_dsl_service.remote_fetcher.make_request", Mock(return_value=response))
    service = AppDslService(session=SimpleNamespace())

    result = service.import_app(
        account=SimpleNamespace(current_tenant_id="tenant-1"),
        import_mode="yaml-url",
        yaml_url="https://example.com/app.yaml",
    )

    assert result.status == ImportStatus.FAILED
    assert "utf-8" in result.error
