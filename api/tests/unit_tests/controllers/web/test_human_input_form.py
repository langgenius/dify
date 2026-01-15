"""Unit tests for controllers.web.human_input_form endpoints."""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, call

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden

import controllers.web.human_input_form as human_input_module
import controllers.web.site as site_module

HumanInputFormApi = human_input_module.HumanInputFormApi
RecipientType = human_input_module.RecipientType
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

    class _FakeDefinition:
        def model_dump(self):
            return {"form_content": "hello"}

    class _FakeForm:
        workflow_run_id = "workflow-1"
        app_id = "app-1"
        tenant_id = "tenant-1"

        def get_definition(self):
            return _FakeDefinition()

    form = _FakeForm()

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
    service_mock.get_form_definition_by_token.return_value = form
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
    assert body["form_content"] == "hello"
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
    service_mock.get_form_definition_by_token.assert_called_once_with(
        RecipientType.STANDALONE_WEB_APP,
        "token-1",
    )


def test_get_form_allows_backstage_token(monkeypatch: pytest.MonkeyPatch, app: Flask):
    """GET falls back to backstage token lookup."""

    class _FakeDefinition:
        def model_dump(self):
            return {"form_content": "hello"}

    class _FakeForm:
        workflow_run_id = "workflow-1"
        app_id = "app-1"
        tenant_id = "tenant-1"

        def get_definition(self):
            return _FakeDefinition()

    form = _FakeForm()
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
    service_mock.get_form_definition_by_token.side_effect = [None, form]
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
    assert body["form_content"] == "hello"
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
    assert service_mock.get_form_definition_by_token.call_args_list == [
        call(RecipientType.STANDALONE_WEB_APP, "token-1"),
        call(RecipientType.BACKSTAGE, "token-1"),
    ]


def test_get_form_raises_forbidden_when_site_missing(monkeypatch: pytest.MonkeyPatch, app: Flask):
    """GET raises Forbidden if site cannot be resolved."""

    class _FakeDefinition:
        def model_dump(self):
            return {"form_content": "hello"}

    class _FakeForm:
        workflow_run_id = "workflow-1"
        app_id = "app-1"
        tenant_id = "tenant-1"

        def get_definition(self):
            return _FakeDefinition()

    form = _FakeForm()
    tenant = SimpleNamespace(status=TenantStatus.NORMAL)
    app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1", tenant=tenant)
    workflow_run = SimpleNamespace(app_id="app-1")

    service_mock = MagicMock()
    service_mock.get_form_definition_by_token.return_value = form
    monkeypatch.setattr(human_input_module, "HumanInputService", lambda engine: service_mock)

    db_stub = _FakeDB(_FakeSession({"WorkflowRun": workflow_run, "App": app_model, "Site": None}))
    monkeypatch.setattr(human_input_module, "db", db_stub)

    with app.test_request_context("/api/form/human_input/token-1", method="GET"):
        with pytest.raises(Forbidden):
            HumanInputFormApi().get("token-1")


def test_submit_form_accepts_backstage_token(monkeypatch: pytest.MonkeyPatch, app: Flask):
    """POST forwards backstage submissions to the service."""

    class _FakeForm:
        recipient_type = RecipientType.BACKSTAGE

    form = _FakeForm()
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
