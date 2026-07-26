from types import SimpleNamespace
from unittest.mock import MagicMock

from controllers.openapi._input_schema import EMPTY_INPUT_SCHEMA
from controllers.openapi.apps import _EMPTY_PARAMETERS, build_app_describe_response
from controllers.service_api.app.error import AppUnavailableError


class _FakeApp(SimpleNamespace):
    pass


def _app() -> _FakeApp:
    from datetime import datetime

    return _FakeApp(
        id="11111111-1111-1111-1111-111111111111",
        name="Demo",
        mode="chat",
        description="d",
        tags=[],
        author_name="me",
        updated_at=datetime(2026, 1, 1),
        enable_api=True,
    )


def test_fields_none_returns_all_blocks(monkeypatch):
    app = _app()
    session = MagicMock()
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


def test_fields_subset_limits_blocks(monkeypatch):
    session = MagicMock()
    monkeypatch.setattr("controllers.openapi.apps.parameters_payload", MagicMock(return_value={"k": "v"}))
    monkeypatch.setattr("controllers.openapi.apps.build_input_schema", MagicMock(return_value={"s": 1}))
    resp = build_app_describe_response(_app(), ["info"], session=session)
    assert resp.info is not None
    assert resp.parameters is None
    assert resp.input_schema is None


def test_info_omits_author_and_tags(monkeypatch):
    session = MagicMock()
    monkeypatch.setattr("controllers.openapi.apps.parameters_payload", MagicMock(return_value={}))
    monkeypatch.setattr("controllers.openapi.apps.build_input_schema", MagicMock(return_value={}))
    resp = build_app_describe_response(_app(), ["info"], session=session)
    assert resp.info is not None
    # Usage-face describe must not expose creator identity or tags (cross-tenant leak).
    assert not hasattr(resp.info, "author")
    assert not hasattr(resp.info, "tags")


def test_parameters_fallback_on_app_unavailable(monkeypatch):
    def _raise(app, *, session):
        raise AppUnavailableError()

    monkeypatch.setattr("controllers.openapi.apps.parameters_payload", _raise)
    monkeypatch.setattr("controllers.openapi.apps.build_input_schema", MagicMock(return_value={"s": 1}))
    resp = build_app_describe_response(_app(), ["parameters"], session=MagicMock())
    assert resp.parameters == dict(_EMPTY_PARAMETERS)


def test_input_schema_fallback_on_app_unavailable(monkeypatch):
    def _raise(app, *, session):
        raise AppUnavailableError()

    monkeypatch.setattr("controllers.openapi.apps.parameters_payload", MagicMock(return_value={"k": "v"}))
    monkeypatch.setattr("controllers.openapi.apps.build_input_schema", _raise)
    resp = build_app_describe_response(_app(), ["input_schema"], session=MagicMock())
    assert resp.input_schema == dict(EMPTY_INPUT_SCHEMA)
