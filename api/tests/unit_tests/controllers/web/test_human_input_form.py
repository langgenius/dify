"""Unit tests for controllers.web.human_input_form endpoints."""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden

import controllers.web.human_input_form as human_input_module

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

    def where(self, *args, **kwargs):  # noqa: ANN002, ANN003
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

        def get_definition(self):
            return _FakeDefinition()

    form = _FakeForm()

    tenant = SimpleNamespace(status=TenantStatus.NORMAL)
    app_model = SimpleNamespace(id="app-1", tenant=tenant)
    workflow_run = SimpleNamespace(app_id="app-1")
    site_model = SimpleNamespace(
        title="My Site",
        icon_type="emoji",
        icon=None,
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

    # Patch serialize_site to a predictable value.
    monkeypatch.setattr(human_input_module, "serialize_site", lambda site: {"title": site.title})

    with app.test_request_context("/api/form/human_input/token-1", method="GET"):
        response = HumanInputFormApi().get("token-1")

    body = json.loads(response.get_data(as_text=True))
    assert body["form_content"] == "hello"
    assert body["site"] == {"title": "My Site"}
    service_mock.get_form_definition_by_token.assert_called_once_with(
        RecipientType.STANDALONE_WEB_APP,
        "token-1",
    )


def test_get_form_raises_forbidden_when_site_missing(monkeypatch: pytest.MonkeyPatch, app: Flask):
    """GET raises Forbidden if site cannot be resolved."""

    class _FakeDefinition:
        def model_dump(self):
            return {"form_content": "hello"}

    class _FakeForm:
        workflow_run_id = "workflow-1"

        def get_definition(self):
            return _FakeDefinition()

    form = _FakeForm()
    tenant = SimpleNamespace(status=TenantStatus.NORMAL)
    app_model = SimpleNamespace(id="app-1", tenant=tenant)
    workflow_run = SimpleNamespace(app_id="app-1")

    service_mock = MagicMock()
    service_mock.get_form_definition_by_token.return_value = form
    monkeypatch.setattr(human_input_module, "HumanInputService", lambda engine: service_mock)

    db_stub = _FakeDB(_FakeSession({"WorkflowRun": workflow_run, "App": app_model, "Site": None}))
    monkeypatch.setattr(human_input_module, "db", db_stub)

    with app.test_request_context("/api/form/human_input/token-1", method="GET"):
        with pytest.raises(Forbidden):
            HumanInputFormApi().get("token-1")
