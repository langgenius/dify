from datetime import datetime
from types import SimpleNamespace
from typing import cast

import pytest
from sqlalchemy.orm import Session

from controllers.openapi._input_schema import EMPTY_INPUT_SCHEMA
from controllers.openapi._models import AppDescribeResponse
from controllers.openapi.apps import _EMPTY_PARAMETERS, AppDescribeApi, build_app_describe_response, settings_hints
from controllers.openapi.auth.requirements import CheckWebAppAuthEnterprise
from controllers.service_api.app.error import AppUnavailableError
from models.model import App, AppMode


def _app() -> App:
    app = App(
        id="11111111-1111-1111-1111-111111111111",
        tenant_id="tenant-1",
        name="Demo",
        mode=AppMode.CHAT,
        description="d",
        enable_api=True,
    )
    app.updated_at = datetime(2026, 1, 1)
    return app


def test_fields_none_returns_all_blocks(monkeypatch, unbound_session: Session):
    app = _app()
    session = unbound_session
    parameters_calls: list[tuple[App, Session]] = []
    input_schema_calls: list[tuple[App, Session]] = []

    def parameters_payload(requested_app: App, *, session: Session):
        parameters_calls.append((requested_app, session))
        return {"k": "v"}

    def input_schema(requested_app: App, *, session: Session):
        input_schema_calls.append((requested_app, session))
        return {"s": 1}

    monkeypatch.setattr("controllers.openapi.apps.parameters_payload", parameters_payload)
    monkeypatch.setattr("controllers.openapi.apps.build_input_schema", input_schema)
    resp = build_app_describe_response(app, None, session=session)
    assert resp.info is not None
    assert resp.info.name == "Demo"
    assert resp.parameters == {"k": "v"}
    assert resp.input_schema == {"s": 1}
    assert parameters_calls == [(app, session)]
    assert input_schema_calls == [(app, session)]


def test_fields_subset_limits_blocks(monkeypatch, unbound_session: Session):
    session = unbound_session
    monkeypatch.setattr("controllers.openapi.apps.parameters_payload", lambda _app, **_kwargs: {"k": "v"})
    monkeypatch.setattr("controllers.openapi.apps.build_input_schema", lambda _app, **_kwargs: {"s": 1})
    resp = build_app_describe_response(_app(), ["info"], session=session)
    assert resp.info is not None
    assert resp.parameters is None
    assert resp.input_schema is None


def test_info_omits_author_and_tags(monkeypatch, unbound_session: Session):
    session = unbound_session
    monkeypatch.setattr("controllers.openapi.apps.parameters_payload", lambda _app, **_kwargs: {})
    monkeypatch.setattr("controllers.openapi.apps.build_input_schema", lambda _app, **_kwargs: {})
    resp = build_app_describe_response(_app(), ["info"], session=session)
    assert resp.info is not None
    # Usage-face describe must not expose creator identity or tags (cross-tenant leak).
    assert not hasattr(resp.info, "author")
    assert not hasattr(resp.info, "tags")


def test_parameters_fallback_on_app_unavailable(monkeypatch, unbound_session: Session):
    def _raise(app, *, session):
        raise AppUnavailableError()

    monkeypatch.setattr("controllers.openapi.apps.parameters_payload", _raise)
    monkeypatch.setattr("controllers.openapi.apps.build_input_schema", lambda _app, **_kwargs: {"s": 1})
    resp = build_app_describe_response(_app(), ["parameters"], session=unbound_session)
    assert resp.parameters == dict(_EMPTY_PARAMETERS)


def test_input_schema_fallback_on_app_unavailable(monkeypatch, unbound_session: Session):
    def _raise(app, *, session):
        raise AppUnavailableError()

    monkeypatch.setattr("controllers.openapi.apps.parameters_payload", lambda _app, **_kwargs: {"k": "v"})
    monkeypatch.setattr("controllers.openapi.apps.build_input_schema", _raise)
    resp = build_app_describe_response(_app(), ["input_schema"], session=unbound_session)
    assert resp.input_schema == dict(EMPTY_INPUT_SCHEMA)


def test_settings_hints_name_the_mode_ops(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(CheckWebAppAuthEnterprise, "available", staticmethod(lambda: True))
    ops = [hint.op for hint in settings_hints("app-1", AppMode.WORKFLOW)]
    assert ops == [
        "describe.app_info.workflow",
        "describe.webapp.workflow",
        "describe.service_api",
        "describe.webapp_access",
    ]
    agent_ops = [hint.op for hint in settings_hints("app-1", AppMode.AGENT)]
    assert agent_ops == [
        "describe.app_info.agent",
        "describe.webapp.agent",
        "describe.service_api.agent",
        "describe.webapp_access.agent",
    ]
    assert all(hint.input == {"app_id": "app-1"} for hint in settings_hints("app-1", AppMode.CHAT))


def test_settings_hints_skip_web_app_access_without_web_app_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(CheckWebAppAuthEnterprise, "available", staticmethod(lambda: False))
    ops = [hint.op for hint in settings_hints("app-1", AppMode.WORKFLOW)]
    assert "describe.webapp_access" not in ops
    assert ops


def _stub_payloads(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("controllers.openapi.apps.parameters_payload", lambda _app, **_kwargs: {})
    monkeypatch.setattr("controllers.openapi.apps.build_input_schema", lambda _app, **_kwargs: {})


def _describe(app: App, session: Session) -> AppDescribeResponse:
    api = AppDescribeApi()
    ctx = SimpleNamespace(app=app, session=session)
    return api.get.__handler__(api, ctx, str(app.id), query=SimpleNamespace(fields=None))


def test_shared_builder_adds_no_hints(monkeypatch: pytest.MonkeyPatch, unbound_session: Session) -> None:
    """The builder also serves describe.console_app.external, whose callers can't use account-only settings ops."""
    _stub_payloads(monkeypatch)
    resp = build_app_describe_response(_app(), None, session=unbound_session)
    assert resp.hints == []


def test_account_describe_adds_settings_hints(monkeypatch: pytest.MonkeyPatch, unbound_session: Session) -> None:
    _stub_payloads(monkeypatch)
    resp = _describe(_app(), unbound_session)
    assert [hint.op for hint in resp.hints] == [hint.op for hint in settings_hints(str(_app().id), AppMode.CHAT)]
    assert resp.hints


def test_account_describe_unknown_mode_has_no_hints(monkeypatch: pytest.MonkeyPatch, unbound_session: Session) -> None:
    _stub_payloads(monkeypatch)
    app = _app()
    app.mode = cast(AppMode, "mode-from-a-newer-version")
    resp = _describe(app, unbound_session)
    assert resp.hints == []
    assert resp.info is not None
