from types import SimpleNamespace
from typing import cast
from unittest.mock import Mock

import pytest
from sqlalchemy.orm import Session

from models import App, AppMode
from models.model import AppModelConfig, IconType
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


def test_create_or_update_app_loads_existing_model_config_with_service_session() -> None:
    session = Mock()
    session.get.return_value = Mock()
    service = AppDslService(session=session)
    app = cast(
        App,
        SimpleNamespace(
            id="app-1",
            tenant_id="tenant-1",
            app_model_config_id="config-1",
            name="Existing app",
            description="",
            icon_type=IconType.EMOJI,
            icon="robot",
            icon_background="#FFFFFF",
        ),
    )

    result = service._create_or_update_app(
        app=app,
        data={"app": {"mode": AppMode.CHAT}, "model_config": {"model": {}}},
        account=Mock(id="account-1"),
    )

    assert result is app
    session.get.assert_called_once_with(AppModelConfig, "config-1")


def test_create_or_update_app_flushes_new_model_config_before_signal(monkeypatch: pytest.MonkeyPatch) -> None:
    events: list[str] = []
    session = Mock()
    session.add.side_effect = lambda _config: events.append("add")
    session.flush.side_effect = lambda: events.append("flush")
    signal = Mock()
    signal.send.side_effect = lambda *_args, **_kwargs: events.append("signal")
    monkeypatch.setattr("services.app_dsl_service.app_model_config_was_updated", signal)
    app = cast(
        App,
        SimpleNamespace(
            id="app-1",
            tenant_id="tenant-1",
            app_model_config_id=None,
            name="Existing app",
            description="",
            icon_type=IconType.EMOJI,
            icon="robot",
            icon_background="#FFFFFF",
        ),
    )

    AppDslService(session=session)._create_or_update_app(
        app=app,
        data={"app": {"mode": AppMode.CHAT}, "model_config": {"model": {}}},
        account=Mock(id="account-1"),
    )

    assert events == ["add", "flush", "signal"]
    assert signal.send.call_args.kwargs["session"] is session
    session.commit.assert_not_called()


def test_export_dsl_loads_model_config_and_annotation_reply_with_request_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    model_config = {"model": {}, "agent_mode": {"tools": []}}
    app_model_config = Mock(app_id="app-1")
    app_model_config.to_dict.return_value = model_config
    session = Mock()
    session.get.return_value = app_model_config
    annotation_reply = {"enabled": False}
    load_annotation_reply_config = Mock(return_value=annotation_reply)
    monkeypatch.setattr("services.app_dsl_service.load_annotation_reply_config", load_annotation_reply_config)
    monkeypatch.setattr(
        "services.app_dsl_service.DependenciesAnalysisService.generate_dependencies",
        Mock(return_value=[]),
    )
    app = cast(
        App,
        SimpleNamespace(
            id="app-1",
            tenant_id="tenant-1",
            app_model_config_id="config-1",
            mode=AppMode.CHAT,
            name="Chat app",
            icon_type=IconType.EMOJI,
            icon="robot",
            icon_background="#FFFFFF",
            description="",
            use_icon_as_answer_icon=False,
        ),
    )

    AppDslService.export_dsl(app, session=session)

    session.get.assert_called_once_with(AppModelConfig, "config-1")
    load_annotation_reply_config.assert_called_once_with(session, "app-1")
    app_model_config.to_dict.assert_called_once_with(annotation_reply=annotation_reply)
