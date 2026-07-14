from unittest.mock import Mock

import pytest
from sqlalchemy.orm import Session

from services.app_dsl_service import AppDslService
from services.entities.dsl_entities import ImportStatus


@pytest.mark.parametrize("sqlite_session", [()], indirect=True)
def test_import_app_rejects_oversized_yaml_content_before_parsing(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    monkeypatch.setattr("services.app_dsl_service.DSL_MAX_SIZE", 3)
    service = AppDslService(session=sqlite_session)
    account = Mock(current_tenant_id="tenant-1")

    result = service.import_app(account=account, import_mode="yaml-content", yaml_content="你你")

    assert result.status == ImportStatus.FAILED
    assert result.error == "File size exceeds the limit of 10MB"
    assert not sqlite_session.in_transaction()


@pytest.mark.parametrize("sqlite_session", [()], indirect=True)
def test_import_app_rejects_oversized_yaml_url_bytes_before_decode(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    monkeypatch.setattr("services.app_dsl_service.DSL_MAX_SIZE", 1)
    response = Mock()
    response.raise_for_status.return_value = None
    response.content = b"\xff\xff"
    monkeypatch.setattr("services.app_dsl_service.remote_fetcher.make_request", Mock(return_value=response))
    service = AppDslService(session=sqlite_session)

    result = service.import_app(
        account=Mock(current_tenant_id="tenant-1"),
        import_mode="yaml-url",
        yaml_url="https://example.com/app.yaml",
    )

    assert result.status == ImportStatus.FAILED
    assert result.error == "File size exceeds the limit of 10MB"
    assert not sqlite_session.in_transaction()


@pytest.mark.parametrize("sqlite_session", [()], indirect=True)
def test_import_app_returns_decode_error_for_invalid_yaml_url_bytes(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    response = Mock()
    response.raise_for_status.return_value = None
    response.content = b"\xff"
    monkeypatch.setattr("services.app_dsl_service.remote_fetcher.make_request", Mock(return_value=response))
    service = AppDslService(session=sqlite_session)

    result = service.import_app(
        account=Mock(current_tenant_id="tenant-1"),
        import_mode="yaml-url",
        yaml_url="https://example.com/app.yaml",
    )

    assert result.status == ImportStatus.FAILED
    assert "utf-8" in result.error
    assert not sqlite_session.in_transaction()
