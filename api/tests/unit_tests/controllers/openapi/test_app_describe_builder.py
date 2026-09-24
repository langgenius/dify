from datetime import datetime
from unittest.mock import MagicMock

from sqlalchemy.orm import Session

from controllers.openapi._input_schema import EMPTY_INPUT_SCHEMA
from controllers.openapi.apps import _EMPTY_PARAMETERS, build_app_describe_response
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
    parameters_payload = MagicMock(return_value={"k": "v"})
    input_schema = MagicMock(return_value={"s": 1})
    monkeypatch.setattr("controllers.openapi.apps.parameters_payload", parameters_payload)
    monkeypatch.setattr("controllers.openapi.apps.build_input_schema", input_schema)
    resp = build_app_describe_response(app, None, session=session)
    assert resp.info is not None
    assert resp.info.name == "Demo"
    assert resp.parameters == {"k": "v"}
    assert resp.input_schema == {"s": 1}
    parameters_payload.assert_called_once_with(app, session=session)
    input_schema.assert_called_once_with(app, session=session)


def test_fields_subset_limits_blocks(monkeypatch, unbound_session: Session):
    session = unbound_session
    monkeypatch.setattr("controllers.openapi.apps.parameters_payload", MagicMock(return_value={"k": "v"}))
    monkeypatch.setattr("controllers.openapi.apps.build_input_schema", MagicMock(return_value={"s": 1}))
    resp = build_app_describe_response(_app(), ["info"], session=session)
    assert resp.info is not None
    assert resp.parameters is None
    assert resp.input_schema is None


def test_info_omits_author_and_tags(monkeypatch, unbound_session: Session):
    session = unbound_session
    monkeypatch.setattr("controllers.openapi.apps.parameters_payload", MagicMock(return_value={}))
    monkeypatch.setattr("controllers.openapi.apps.build_input_schema", MagicMock(return_value={}))
    resp = build_app_describe_response(_app(), ["info"], session=session)
    assert resp.info is not None
    # Usage-face describe must not expose creator identity or tags (cross-tenant leak).
    assert not hasattr(resp.info, "author")
    assert not hasattr(resp.info, "tags")


def test_parameters_fallback_on_app_unavailable(monkeypatch, unbound_session: Session):
    def _raise(app, *, session):
        raise AppUnavailableError()

    monkeypatch.setattr("controllers.openapi.apps.parameters_payload", _raise)
    monkeypatch.setattr("controllers.openapi.apps.build_input_schema", MagicMock(return_value={"s": 1}))
    resp = build_app_describe_response(_app(), ["parameters"], session=unbound_session)
    assert resp.parameters == dict(_EMPTY_PARAMETERS)


def test_input_schema_fallback_on_app_unavailable(monkeypatch, unbound_session: Session):
    def _raise(app, *, session):
        raise AppUnavailableError()

    monkeypatch.setattr("controllers.openapi.apps.parameters_payload", MagicMock(return_value={"k": "v"}))
    monkeypatch.setattr("controllers.openapi.apps.build_input_schema", _raise)
    resp = build_app_describe_response(_app(), ["input_schema"], session=unbound_session)
    assert resp.input_schema == dict(EMPTY_INPUT_SCHEMA)
