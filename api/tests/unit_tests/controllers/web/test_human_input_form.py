"""Unit tests for controllers.web.human_input_form endpoints."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import Forbidden

import controllers.web.human_input_form as human_input_module
import controllers.web.site as site_module
from controllers.web.error import WebFormRateLimitExceededError
from core.workflow.nodes.human_input.entities import ParagraphInputConfig, SelectInputConfig, StringListSource
from core.workflow.nodes.human_input.enums import ValueSourceType
from models import Tenant
from models.enums import CustomizeTokenStrategy
from models.human_input import RecipientType
from models.model import App, AppMode, IconType, Site
from services.feature_service import FeatureModel
from services.human_input_service import FormExpiredError

HumanInputFormApi = human_input_module.HumanInputFormApi
HumanInputFormUploadTokenApi = human_input_module.HumanInputFormUploadTokenApi

SQLITE_MODELS = (Tenant, App, Site)
pytestmark = [
    pytest.mark.usefixtures("sqlite_session"),
    pytest.mark.parametrize("sqlite_session", [SQLITE_MODELS], indirect=True),
]


@pytest.fixture
def app() -> Flask:
    """Configure a minimal Flask app for request contexts."""

    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


@pytest.fixture
def database_session(
    sqlite_session: Session,
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> Session:
    """Bind model/controller database access to the shared SQLite session."""

    database = SimpleNamespace(engine=sqlite_engine, session=sqlite_session)
    monkeypatch.setattr(human_input_module, "db", database)
    monkeypatch.setattr("models.model.db", database)
    return sqlite_session


def _persist_app_site(session: Session, *, include_site: bool = True) -> tuple[Tenant, App, Site | None]:
    tenant = Tenant(name="Tenant", plan="basic")
    tenant.custom_config_dict = {"remove_webapp_brand": True, "replace_webapp_logo": None}
    app_model = App(
        id=str(uuid4()),
        tenant_id=tenant.id,
        name="Human Input App",
        mode=AppMode.CHAT,
        icon_type=IconType.EMOJI,
        icon="robot",
        icon_background="#fff",
        enable_site=True,
        enable_api=False,
    )
    site = None
    models: list[object] = [tenant, app_model]
    if include_site:
        site = Site(
            app_id=app_model.id,
            title="My Site",
            default_language="en",
            customize_token_strategy=CustomizeTokenStrategy.UUID,
            icon_type=IconType.EMOJI,
            icon="robot",
            icon_background="#fff",
            description="desc",
            input_placeholder="Ask the app",
            chat_color_theme="light",
            chat_color_theme_inverted=False,
            custom_disclaimer="",
            prompt_public=False,
            show_workflow_steps=True,
            use_icon_as_answer_icon=False,
        )
        models.append(site)
    session.add_all(models)
    session.commit()
    return tenant, app_model, site


def test_get_form_includes_site(monkeypatch: pytest.MonkeyPatch, app: Flask, database_session: Session):
    """GET returns form definition merged with site payload."""

    expiration_time = datetime(2099, 1, 1, tzinfo=UTC)
    _, app_model, _ = _persist_app_site(database_session)

    class _FakeDefinition:
        def model_dump(self, mode: str | None = None):
            return {
                "form_content": "Raw content",
                "rendered_content": "Rendered {{#$output.name#}}",
                "inputs": [{"type": "text", "output_variable_name": "name", "default": None}],
                "default_values": {"name": "Alice", "age": 30, "meta": {"k": "v"}},
                "user_actions": [{"id": "approve", "title": "Approve", "button_style": "default"}],
            }

    class _FakeForm:
        def __init__(self, expiration: datetime):
            self.workflow_run_id = None
            self.app_id = app_model.id
            self.tenant_id = app_model.tenant_id
            self.expiration_time = expiration
            self.recipient_type = RecipientType.BACKSTAGE

        def get_definition(self):
            return _FakeDefinition()

    form = _FakeForm(expiration_time)
    limiter_mock = MagicMock()
    limiter_mock.is_rate_limited.return_value = False
    monkeypatch.setattr(human_input_module, "_FORM_ACCESS_RATE_LIMITER", limiter_mock)
    monkeypatch.setattr(human_input_module, "extract_remote_ip", lambda req: "203.0.113.10")

    # Patch service to return fake form.
    service_mock = MagicMock()
    service_mock.get_form_by_token.return_value = form
    resolved_input = ParagraphInputConfig(output_variable_name="name")
    service_mock.resolve_form_inputs.return_value = [resolved_input]
    monkeypatch.setattr(human_input_module, "HumanInputService", lambda engine: service_mock)

    monkeypatch.setattr(
        site_module.FeatureService,
        "get_features",
        lambda tenant_id, **_kwargs: FeatureModel(can_replace_logo=True, webapp_copyright_enabled=True),
    )

    with app.test_request_context("/api/form/human_input/token-1", method="GET"):
        response = HumanInputFormApi().get("token-1")

    body = response
    assert set(body.keys()) == {
        "site",
        "form_content",
        "inputs",
        "resolved_default_values",
        "user_actions",
        "expiration_time",
    }
    assert body["form_content"] == "Rendered {{#$output.name#}}"
    assert body["inputs"] == [resolved_input.model_dump(mode="json")]
    assert body["resolved_default_values"] == {"name": "Alice", "age": "30", "meta": '{"k": "v"}'}
    assert body["user_actions"] == [{"id": "approve", "title": "Approve", "button_style": "default"}]
    assert body["expiration_time"] == int(expiration_time.timestamp())
    assert body["site"] == {
        "app_id": app_model.id,
        "end_user_id": None,
        "enable_site": True,
        "site": {
            "title": "My Site",
            "chat_color_theme": "light",
            "chat_color_theme_inverted": False,
            "icon_type": "emoji",
            "icon": "robot",
            "icon_background": "#fff",
            "icon_url": None,
            "description": "desc",
            "copyright": None,
            "privacy_policy": None,
            "input_placeholder": "Ask the app",
            "custom_disclaimer": "",
            "default_language": "en",
            "prompt_public": False,
            "show_workflow_steps": True,
            "use_icon_as_answer_icon": False,
        },
        "model_config": None,
        "plan": "basic",
        "can_replace_logo": True,
        "custom_config": {
            "remove_webapp_brand": True,
            "replace_webapp_logo": None,
        },
    }
    service_mock.get_form_by_token.assert_called_once_with("token-1")
    limiter_mock.is_rate_limited.assert_called_once_with("203.0.113.10")
    limiter_mock.increment_rate_limit.assert_called_once_with("203.0.113.10")


def test_get_form_uses_runtime_select_options(monkeypatch: pytest.MonkeyPatch, app: Flask, database_session: Session):
    """GET returns variable-backed select options resolved from runtime state."""

    expiration_time = datetime(2099, 1, 1, tzinfo=UTC)
    _, app_model, _ = _persist_app_site(database_session)
    configured_inputs = [
        {
            "type": "select",
            "output_variable_name": "decision",
            "option_source": {
                "type": "variable",
                "selector": ["start", "options"],
                "value": ["configured"],
            },
        }
    ]
    runtime_inputs = [
        SelectInputConfig(
            output_variable_name="decision",
            option_source=StringListSource(
                type=ValueSourceType.VARIABLE,
                selector=["start", "options"],
                value=["approve", "reject"],
            ),
        )
    ]

    class _FakeDefinition:
        def model_dump(self, mode: str | None = None):
            return {
                "form_content": "Raw content",
                "rendered_content": "Rendered",
                "inputs": configured_inputs,
                "default_values": {},
                "user_actions": [],
            }

    class _FakeForm:
        def __init__(self, expiration: datetime):
            self.workflow_run_id = None
            self.app_id = app_model.id
            self.tenant_id = app_model.tenant_id
            self.recipient_type = RecipientType.STANDALONE_WEB_APP
            self.expiration_time = expiration

        def get_definition(self):
            return _FakeDefinition()

    limiter_mock = MagicMock()
    limiter_mock.is_rate_limited.return_value = False
    monkeypatch.setattr(human_input_module, "_FORM_ACCESS_RATE_LIMITER", limiter_mock)
    monkeypatch.setattr(human_input_module, "extract_remote_ip", lambda req: "203.0.113.10")

    form = _FakeForm(expiration_time)
    service_mock = MagicMock()
    service_mock.get_form_by_token.return_value = form
    service_mock.resolve_form_inputs.return_value = runtime_inputs
    monkeypatch.setattr(human_input_module, "HumanInputService", lambda engine: service_mock)

    def mock_get_features(tenant_id: str, exclude_vector_space: bool = False):
        return FeatureModel(can_replace_logo=True)

    monkeypatch.setattr(site_module.FeatureService, "get_features", mock_get_features)

    with app.test_request_context("/api/form/human_input/token-1", method="GET"):
        response = HumanInputFormApi().get("token-1")

    body = response
    assert body["inputs"] == [input_config.model_dump(mode="json") for input_config in runtime_inputs]
    service_mock.resolve_form_inputs.assert_called_once_with(form)


def test_create_upload_token_returns_token_and_form_expiration(
    monkeypatch: pytest.MonkeyPatch, app: Flask, sqlite_engine: Engine
):
    """POST returns a HITL upload token for an active form token."""

    expiration_time = datetime(2099, 1, 1, tzinfo=UTC)
    service_mock = MagicMock()
    service_mock.issue_upload_token.return_value = SimpleNamespace(
        upload_token="hitl_upload_token-1",
        expires_at=expiration_time,
    )
    workflow_run_repository = MagicMock()
    repo_factory = MagicMock(return_value=workflow_run_repository)
    captured: dict[str, object] = {}

    def _service_factory(session_factory, workflow_run_repository):
        captured["session_factory"] = session_factory
        captured["workflow_run_repository"] = workflow_run_repository
        return service_mock

    monkeypatch.setattr(
        human_input_module.DifyAPIRepositoryFactory,
        "create_api_workflow_run_repository",
        repo_factory,
    )
    monkeypatch.setattr(
        human_input_module,
        "HumanInputFileUploadService",
        _service_factory,
    )
    monkeypatch.setattr(human_input_module, "db", SimpleNamespace(engine=sqlite_engine))

    limiter_mock = MagicMock()
    limiter_mock.is_rate_limited.return_value = False
    monkeypatch.setattr(human_input_module, "_FORM_UPLOAD_TOKEN_RATE_LIMITER", limiter_mock)
    monkeypatch.setattr(human_input_module, "extract_remote_ip", lambda req: "203.0.113.10")

    with app.test_request_context("/api/form/human_input/token-1/upload-token", method="POST"):
        result, status = HumanInputFormUploadTokenApi().post("token-1")

    assert status == 200
    assert result == {
        "upload_token": "hitl_upload_token-1",
        "expires_at": int(expiration_time.timestamp()),
    }
    repo_factory.assert_called_once()
    assert captured["workflow_run_repository"] is workflow_run_repository
    session_factory = captured["session_factory"]
    assert isinstance(session_factory, sessionmaker)
    assert session_factory.kw["bind"] is sqlite_engine
    service_mock.issue_upload_token.assert_called_once_with("token-1")
    limiter_mock.increment_rate_limit.assert_called_once_with("203.0.113.10")


def test_get_form_allows_backstage_token(monkeypatch: pytest.MonkeyPatch, app: Flask, database_session: Session):
    """GET returns form payload for backstage token."""

    expiration_time = datetime(2099, 1, 2, tzinfo=UTC)
    _, app_model, _ = _persist_app_site(database_session)

    class _FakeDefinition:
        def model_dump(self, mode: str | None = None):
            return {
                "form_content": "Raw content",
                "rendered_content": "Rendered",
                "inputs": [],
                "default_values": {},
                "user_actions": [],
            }

    class _FakeForm:
        def __init__(self, expiration: datetime):
            self.workflow_run_id = None
            self.app_id = app_model.id
            self.tenant_id = app_model.tenant_id
            self.expiration_time = expiration

        def get_definition(self):
            return _FakeDefinition()

    form = _FakeForm(expiration_time)
    limiter_mock = MagicMock()
    limiter_mock.is_rate_limited.return_value = False
    monkeypatch.setattr(human_input_module, "_FORM_ACCESS_RATE_LIMITER", limiter_mock)
    monkeypatch.setattr(human_input_module, "extract_remote_ip", lambda req: "203.0.113.10")
    service_mock = MagicMock()
    service_mock.get_form_by_token.return_value = form
    service_mock.resolve_form_inputs.return_value = []
    monkeypatch.setattr(human_input_module, "HumanInputService", lambda engine: service_mock)

    monkeypatch.setattr(
        site_module.FeatureService,
        "get_features",
        lambda tenant_id, **_kwargs: FeatureModel(can_replace_logo=True, webapp_copyright_enabled=True),
    )

    with app.test_request_context("/api/form/human_input/token-1", method="GET"):
        response = HumanInputFormApi().get("token-1")

    body = response
    assert set(body.keys()) == {
        "site",
        "form_content",
        "inputs",
        "resolved_default_values",
        "user_actions",
        "expiration_time",
    }
    assert body["form_content"] == "Rendered"
    assert body["inputs"] == []
    assert body["resolved_default_values"] == {}
    assert body["user_actions"] == []
    assert body["expiration_time"] == int(expiration_time.timestamp())
    assert body["site"] == {
        "app_id": app_model.id,
        "end_user_id": None,
        "enable_site": True,
        "site": {
            "title": "My Site",
            "chat_color_theme": "light",
            "chat_color_theme_inverted": False,
            "icon_type": "emoji",
            "icon": "robot",
            "icon_background": "#fff",
            "icon_url": None,
            "description": "desc",
            "copyright": None,
            "privacy_policy": None,
            "input_placeholder": "Ask the app",
            "custom_disclaimer": "",
            "default_language": "en",
            "prompt_public": False,
            "show_workflow_steps": True,
            "use_icon_as_answer_icon": False,
        },
        "model_config": None,
        "plan": "basic",
        "can_replace_logo": True,
        "custom_config": {
            "remove_webapp_brand": True,
            "replace_webapp_logo": None,
        },
    }
    service_mock.get_form_by_token.assert_called_once_with("token-1")
    limiter_mock.is_rate_limited.assert_called_once_with("203.0.113.10")
    limiter_mock.increment_rate_limit.assert_called_once_with("203.0.113.10")


def test_get_form_raises_forbidden_when_site_missing(
    monkeypatch: pytest.MonkeyPatch, app: Flask, database_session: Session
):
    """GET raises Forbidden if site cannot be resolved."""

    expiration_time = datetime(2099, 1, 3, tzinfo=UTC)
    _, app_model, _ = _persist_app_site(database_session, include_site=False)

    class _FakeDefinition:
        def model_dump(self, mode: str | None = None):
            return {
                "form_content": "Raw content",
                "rendered_content": "Rendered",
                "inputs": [],
                "default_values": {},
                "user_actions": [],
            }

    class _FakeForm:
        def __init__(self, expiration: datetime):
            self.workflow_run_id = None
            self.app_id = app_model.id
            self.tenant_id = app_model.tenant_id
            self.expiration_time = expiration

        def get_definition(self):
            return _FakeDefinition()

    form = _FakeForm(expiration_time)
    limiter_mock = MagicMock()
    limiter_mock.is_rate_limited.return_value = False
    monkeypatch.setattr(human_input_module, "_FORM_ACCESS_RATE_LIMITER", limiter_mock)
    monkeypatch.setattr(human_input_module, "extract_remote_ip", lambda req: "203.0.113.10")
    service_mock = MagicMock()
    service_mock.get_form_by_token.return_value = form
    monkeypatch.setattr(human_input_module, "HumanInputService", lambda engine: service_mock)

    with app.test_request_context("/api/form/human_input/token-1", method="GET"):
        with pytest.raises(Forbidden):
            HumanInputFormApi().get("token-1")
    limiter_mock.is_rate_limited.assert_called_once_with("203.0.113.10")
    limiter_mock.increment_rate_limit.assert_called_once_with("203.0.113.10")


def test_submit_form_accepts_backstage_token(monkeypatch: pytest.MonkeyPatch, app: Flask, sqlite_engine: Engine):
    """POST forwards backstage submissions to the service."""

    class _FakeForm:
        recipient_type = RecipientType.BACKSTAGE

    form = _FakeForm()
    limiter_mock = MagicMock()
    limiter_mock.is_rate_limited.return_value = False
    monkeypatch.setattr(human_input_module, "_FORM_SUBMIT_RATE_LIMITER", limiter_mock)
    monkeypatch.setattr(human_input_module, "extract_remote_ip", lambda req: "203.0.113.10")
    service_mock = MagicMock()
    service_mock.get_form_by_token.return_value = form
    monkeypatch.setattr(human_input_module, "HumanInputService", lambda engine: service_mock)
    monkeypatch.setattr(human_input_module, "db", SimpleNamespace(engine=sqlite_engine))

    with app.test_request_context(
        "/api/form/human_input/token-1",
        method="POST",
        json={"inputs": {"content": "ok"}, "action": "approve"},
    ):
        response, status = HumanInputFormApi().post("token-1")

    assert status == 200
    assert response == {}
    service_mock.submit_form_by_token.assert_called_once_with(
        recipient_type=RecipientType.BACKSTAGE,
        form_token="token-1",
        selected_action_id="approve",
        form_data={"content": "ok"},
        submission_end_user_id=None,
    )
    limiter_mock.is_rate_limited.assert_called_once_with("203.0.113.10")
    limiter_mock.increment_rate_limit.assert_called_once_with("203.0.113.10")


def test_submit_form_rate_limited(monkeypatch: pytest.MonkeyPatch, app: Flask):
    """POST rejects submissions when rate limit is exceeded."""

    limiter_mock = MagicMock()
    limiter_mock.is_rate_limited.return_value = True
    monkeypatch.setattr(human_input_module, "_FORM_SUBMIT_RATE_LIMITER", limiter_mock)
    monkeypatch.setattr(human_input_module, "extract_remote_ip", lambda req: "203.0.113.10")

    service_mock = MagicMock()
    service_mock.get_form_by_token.return_value = None
    monkeypatch.setattr(human_input_module, "HumanInputService", lambda engine: service_mock)

    with app.test_request_context(
        "/api/form/human_input/token-1",
        method="POST",
        json={"inputs": {"content": "ok"}, "action": "approve"},
    ):
        with pytest.raises(WebFormRateLimitExceededError):
            HumanInputFormApi().post("token-1")

    limiter_mock.is_rate_limited.assert_called_once_with("203.0.113.10")
    limiter_mock.increment_rate_limit.assert_not_called()
    service_mock.get_form_by_token.assert_not_called()


def test_get_form_rate_limited(monkeypatch: pytest.MonkeyPatch, app: Flask):
    """GET rejects requests when rate limit is exceeded."""

    limiter_mock = MagicMock()
    limiter_mock.is_rate_limited.return_value = True
    monkeypatch.setattr(human_input_module, "_FORM_ACCESS_RATE_LIMITER", limiter_mock)
    monkeypatch.setattr(human_input_module, "extract_remote_ip", lambda req: "203.0.113.10")

    service_mock = MagicMock()
    service_mock.get_form_by_token.return_value = None
    monkeypatch.setattr(human_input_module, "HumanInputService", lambda engine: service_mock)

    with app.test_request_context("/api/form/human_input/token-1", method="GET"):
        with pytest.raises(WebFormRateLimitExceededError):
            HumanInputFormApi().get("token-1")

    limiter_mock.is_rate_limited.assert_called_once_with("203.0.113.10")
    limiter_mock.increment_rate_limit.assert_not_called()
    service_mock.get_form_by_token.assert_not_called()


def test_get_form_raises_expired(monkeypatch: pytest.MonkeyPatch, app: Flask, sqlite_engine: Engine):
    class _FakeForm:
        pass

    form = _FakeForm()
    limiter_mock = MagicMock()
    limiter_mock.is_rate_limited.return_value = False
    monkeypatch.setattr(human_input_module, "_FORM_ACCESS_RATE_LIMITER", limiter_mock)
    monkeypatch.setattr(human_input_module, "extract_remote_ip", lambda req: "203.0.113.10")
    service_mock = MagicMock()
    service_mock.get_form_by_token.return_value = form
    service_mock.ensure_form_active.side_effect = FormExpiredError("form-id")
    monkeypatch.setattr(human_input_module, "HumanInputService", lambda engine: service_mock)
    monkeypatch.setattr(human_input_module, "db", SimpleNamespace(engine=sqlite_engine))

    with app.test_request_context("/api/form/human_input/token-1", method="GET"):
        with pytest.raises(FormExpiredError):
            HumanInputFormApi().get("token-1")

    service_mock.ensure_form_active.assert_called_once_with(form)
    limiter_mock.is_rate_limited.assert_called_once_with("203.0.113.10")
    limiter_mock.increment_rate_limit.assert_called_once_with("203.0.113.10")
