"""Unit tests for controllers.web.human_input_form endpoints."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden

import controllers.web.human_input_form as human_input_module
import controllers.web.site as site_module
from controllers.web.error import WebFormRateLimitExceededError
from models.human_input import RecipientType
from services.human_input_service import FormExpiredError

HumanInputFormApi = human_input_module.HumanInputFormApi
TenantStatus = human_input_module.TenantStatus


@pytest.fixture
def app() -> Flask:
    """Configure a minimal Flask app for request contexts."""

    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


class _FakeSession:
    """Simple stand-in for db.session that returns pre-seeded objects."""

    def __init__(self, mapping: dict[str, Any]):
        self._mapping = mapping
        self._model_name: str | None = None

    def query(self, model):
        self._model_name = model.__name__
        return self

    def where(self, *args, **kwargs):
        return self

    def first(self):
        assert self._model_name is not None
        return self._mapping.get(self._model_name)


class _FakeDB:
    """Minimal db stub exposing engine and session."""

    def __init__(self, session: _FakeSession):
        self.session = session
        self.engine = object()


def test_get_form_includes_site(monkeypatch: pytest.MonkeyPatch, app: Flask):
    """GET returns form definition merged with site payload."""

    expiration_time = datetime(2099, 1, 1, tzinfo=UTC)

    class _FakeDefinition:
        def model_dump(self):
            return {
                "form_content": "Raw content",
                "rendered_content": "Rendered {{#$output.name#}}",
                "inputs": [{"type": "text", "output_variable_name": "name", "default": None}],
                "default_values": {"name": "Alice", "age": 30, "meta": {"k": "v"}},
                "user_actions": [{"id": "approve", "title": "Approve", "button_style": "default"}],
            }

    class _FakeForm:
        def __init__(self, expiration: datetime):
            self.workflow_run_id = "workflow-1"
            self.app_id = "app-1"
            self.tenant_id = "tenant-1"
            self.expiration_time = expiration
            self.recipient_type = RecipientType.BACKSTAGE

        def get_definition(self):
            return _FakeDefinition()

    form = _FakeForm(expiration_time)
    limiter_mock = MagicMock()
    limiter_mock.is_rate_limited.return_value = False
    monkeypatch.setattr(human_input_module, "_FORM_ACCESS_RATE_LIMITER", limiter_mock)
    monkeypatch.setattr(human_input_module, "extract_remote_ip", lambda req: "203.0.113.10")

    tenant = SimpleNamespace(
        id="tenant-1",
        status=TenantStatus.NORMAL,
        plan="basic",
        custom_config_dict={"remove_webapp_brand": True, "replace_webapp_logo": False},
    )
    app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1", tenant=tenant, enable_site=True)
    workflow_run = SimpleNamespace(app_id="app-1")
    site_model = SimpleNamespace(
        title="My Site",
        icon_type="emoji",
        icon="robot",
        icon_background="#fff",
        description="desc",
        default_language="en",
        chat_color_theme="light",
        chat_color_theme_inverted=False,
        copyright=None,
        privacy_policy=None,
        custom_disclaimer=None,
        prompt_public=False,
        show_workflow_steps=True,
        use_icon_as_answer_icon=False,
    )

    # Patch service to return fake form.
    service_mock = MagicMock()
    service_mock.get_form_by_token.return_value = form
    monkeypatch.setattr(human_input_module, "HumanInputService", lambda engine: service_mock)

    # Patch db session.
    db_stub = _FakeDB(_FakeSession({"WorkflowRun": workflow_run, "App": app_model, "Site": site_model}))
    monkeypatch.setattr(human_input_module, "db", db_stub)

    monkeypatch.setattr(
        site_module.FeatureService,
        "get_features",
        lambda tenant_id: SimpleNamespace(can_replace_logo=True),
    )

    with app.test_request_context("/api/form/human_input/token-1", method="GET"):
        response = HumanInputFormApi().get("token-1")

    body = json.loads(response.get_data(as_text=True))
    assert set(body.keys()) == {
        "site",
        "form_content",
        "inputs",
        "resolved_default_values",
        "user_actions",
        "expiration_time",
    }
    assert body["form_content"] == "Rendered {{#$output.name#}}"
    assert body["inputs"] == [{"type": "text", "output_variable_name": "name", "default": None}]
    assert body["resolved_default_values"] == {"name": "Alice", "age": "30", "meta": '{"k": "v"}'}
    assert body["user_actions"] == [{"id": "approve", "title": "Approve", "button_style": "default"}]
    assert body["expiration_time"] == int(expiration_time.timestamp())
    assert body["site"] == {
        "app_id": "app-1",
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
            "custom_disclaimer": None,
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


def test_get_form_allows_backstage_token(monkeypatch: pytest.MonkeyPatch, app: Flask):
    """GET returns form payload for backstage token."""

    expiration_time = datetime(2099, 1, 2, tzinfo=UTC)

    class _FakeDefinition:
        def model_dump(self):
            return {
                "form_content": "Raw content",
                "rendered_content": "Rendered",
                "inputs": [],
                "default_values": {},
                "user_actions": [],
            }

    class _FakeForm:
        def __init__(self, expiration: datetime):
            self.workflow_run_id = "workflow-1"
            self.app_id = "app-1"
            self.tenant_id = "tenant-1"
            self.expiration_time = expiration

        def get_definition(self):
            return _FakeDefinition()

    form = _FakeForm(expiration_time)
    limiter_mock = MagicMock()
    limiter_mock.is_rate_limited.return_value = False
    monkeypatch.setattr(human_input_module, "_FORM_ACCESS_RATE_LIMITER", limiter_mock)
    monkeypatch.setattr(human_input_module, "extract_remote_ip", lambda req: "203.0.113.10")
    tenant = SimpleNamespace(
        id="tenant-1",
        status=TenantStatus.NORMAL,
        plan="basic",
        custom_config_dict={"remove_webapp_brand": True, "replace_webapp_logo": False},
    )
    app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1", tenant=tenant, enable_site=True)
    workflow_run = SimpleNamespace(app_id="app-1")
    site_model = SimpleNamespace(
        title="My Site",
        icon_type="emoji",
        icon="robot",
        icon_background="#fff",
        description="desc",
        default_language="en",
        chat_color_theme="light",
        chat_color_theme_inverted=False,
        copyright=None,
        privacy_policy=None,
        custom_disclaimer=None,
        prompt_public=False,
        show_workflow_steps=True,
        use_icon_as_answer_icon=False,
    )

    service_mock = MagicMock()
    service_mock.get_form_by_token.return_value = form
    monkeypatch.setattr(human_input_module, "HumanInputService", lambda engine: service_mock)

    db_stub = _FakeDB(_FakeSession({"WorkflowRun": workflow_run, "App": app_model, "Site": site_model}))
    monkeypatch.setattr(human_input_module, "db", db_stub)

    monkeypatch.setattr(
        site_module.FeatureService,
        "get_features",
        lambda tenant_id: SimpleNamespace(can_replace_logo=True),
    )

    with app.test_request_context("/api/form/human_input/token-1", method="GET"):
        response = HumanInputFormApi().get("token-1")

    body = json.loads(response.get_data(as_text=True))
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
        "app_id": "app-1",
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
            "custom_disclaimer": None,
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


def test_get_form_raises_forbidden_when_site_missing(monkeypatch: pytest.MonkeyPatch, app: Flask):
    """GET raises Forbidden if site cannot be resolved."""

    expiration_time = datetime(2099, 1, 3, tzinfo=UTC)

    class _FakeDefinition:
        def model_dump(self):
            return {
                "form_content": "Raw content",
                "rendered_content": "Rendered",
                "inputs": [],
                "default_values": {},
                "user_actions": [],
            }

    class _FakeForm:
        def __init__(self, expiration: datetime):
            self.workflow_run_id = "workflow-1"
            self.app_id = "app-1"
            self.tenant_id = "tenant-1"
            self.expiration_time = expiration

        def get_definition(self):
            return _FakeDefinition()

    form = _FakeForm(expiration_time)
    limiter_mock = MagicMock()
    limiter_mock.is_rate_limited.return_value = False
    monkeypatch.setattr(human_input_module, "_FORM_ACCESS_RATE_LIMITER", limiter_mock)
    monkeypatch.setattr(human_input_module, "extract_remote_ip", lambda req: "203.0.113.10")
    tenant = SimpleNamespace(status=TenantStatus.NORMAL)
    app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1", tenant=tenant)
    workflow_run = SimpleNamespace(app_id="app-1")

    service_mock = MagicMock()
    service_mock.get_form_by_token.return_value = form
    monkeypatch.setattr(human_input_module, "HumanInputService", lambda engine: service_mock)

    db_stub = _FakeDB(_FakeSession({"WorkflowRun": workflow_run, "App": app_model, "Site": None}))
    monkeypatch.setattr(human_input_module, "db", db_stub)

    with app.test_request_context("/api/form/human_input/token-1", method="GET"):
        with pytest.raises(Forbidden):
            HumanInputFormApi().get("token-1")
    limiter_mock.is_rate_limited.assert_called_once_with("203.0.113.10")
    limiter_mock.increment_rate_limit.assert_called_once_with("203.0.113.10")


def test_submit_form_accepts_backstage_token(monkeypatch: pytest.MonkeyPatch, app: Flask):
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
    monkeypatch.setattr(human_input_module, "db", _FakeDB(_FakeSession({})))

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
    monkeypatch.setattr(human_input_module, "db", _FakeDB(_FakeSession({})))

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
    monkeypatch.setattr(human_input_module, "db", _FakeDB(_FakeSession({})))

    with app.test_request_context("/api/form/human_input/token-1", method="GET"):
        with pytest.raises(WebFormRateLimitExceededError):
            HumanInputFormApi().get("token-1")

    limiter_mock.is_rate_limited.assert_called_once_with("203.0.113.10")
    limiter_mock.increment_rate_limit.assert_not_called()
    service_mock.get_form_by_token.assert_not_called()


def test_get_form_raises_expired(monkeypatch: pytest.MonkeyPatch, app: Flask):
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
    monkeypatch.setattr(human_input_module, "db", _FakeDB(_FakeSession({})))

    with app.test_request_context("/api/form/human_input/token-1", method="GET"):
        with pytest.raises(FormExpiredError):
            HumanInputFormApi().get("token-1")

    service_mock.ensure_form_active.assert_called_once_with(form)
    limiter_mock.is_rate_limited.assert_called_once_with("203.0.113.10")
    limiter_mock.increment_rate_limit.assert_called_once_with("203.0.113.10")
