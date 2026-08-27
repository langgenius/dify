"""Tests for openapi human input form endpoints.

Auth is not exercised here: `@endpoint` resolves the `Context` before the handler
runs, and the allow/deny answers live in `test_auth_matrix.py`. Body tests call
`__handler__` — the documented seam — with a `Context` double. The 422 test goes
through `__wrapped__` instead, so `@accepts` still runs against the real request.
"""

from __future__ import annotations

import json
import sys
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from flask import Flask
from werkzeug.exceptions import UnprocessableEntity

from controllers.common.human_input import HumanInputFormSubmitPayload
from controllers.openapi._errors import HumanInputFormNotFound, RecipientSurfaceMismatch
from controllers.openapi._models import FormSubmitResponse
from controllers.openapi.auth.data import CallerKind
from controllers.openapi.human_input_form import (
    OpenApiWorkflowHumanInputFormApi,
    OpenApiWorkflowHumanInputFormSubmitApi,
)
from models.account import Account
from models.enums import EndUserType
from models.human_input import RecipientType
from models.model import App, AppMode, EndUser

_MODULE = "controllers.openapi.human_input_form"


def _context(caller: Account | EndUser, caller_kind: CallerKind) -> SimpleNamespace:
    app_model = App(
        id="app-1",
        tenant_id="tenant-1",
        name="Human input app",
        mode=AppMode.WORKFLOW,
        enable_site=True,
        enable_api=True,
    )
    return SimpleNamespace(app=app_model, caller=caller, subject=SimpleNamespace(caller_kind=caller_kind))


def _mock_service(monkeypatch: pytest.MonkeyPatch, form) -> Mock:
    """Bind a mocked `HumanInputService` (and the engine it is built from) into the module."""
    service_mock = Mock()
    service_mock.get_form_by_token.return_value = form
    module = sys.modules[_MODULE]
    monkeypatch.setattr(module, "HumanInputService", lambda _engine: service_mock)
    monkeypatch.setattr(module, "db", SimpleNamespace(engine=object()))
    return service_mock


def _make_form(app_id: str = "app-1", recipient_type=RecipientType.STANDALONE_WEB_APP) -> SimpleNamespace:
    return SimpleNamespace(
        app_id=app_id,
        tenant_id="tenant-1",
        recipient_type=recipient_type,
        expiration_time=datetime(2099, 1, 1, tzinfo=UTC),
    )


def _make_account(account_id: str = "acct-1") -> Account:
    account = Account(name="Human Input User", email=f"{account_id}@example.com")
    account.id = account_id
    return account


def _make_end_user(end_user_id: str = "eu-1") -> EndUser:
    return EndUser(
        id=end_user_id,
        tenant_id="tenant-1",
        app_id="app-1",
        type=EndUserType.OPENAPI,
        session_id=f"session-{end_user_id}",
    )


@pytest.mark.parametrize(
    ("view", "write"),
    [(OpenApiWorkflowHumanInputFormApi.get, False), (OpenApiWorkflowHumanInputFormSubmitApi.post, False)],
    ids=["get", "submit"],
)
def test_transaction_boundary_matches_the_pre_migration_decorator(view, write: bool):
    """Neither route carried `@with_session`: `HumanInputService` owns a session off
    `db.engine`, and `submit` commits through that one, so the submission is durable
    without a router commit. The allow/deny matrix cannot see this — it observes
    admission before the view body runs.
    """
    assert view.__spec__.write is write


class TestOpenApiHumanInputFormGet:
    def test_get_success(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        definition = SimpleNamespace(
            model_dump=lambda: {
                "rendered_content": "Fill out the form",
                "inputs": [{"output_variable_name": "field1"}],
                "default_values": {"field1": "default"},
                "user_actions": [{"id": "submit", "title": "Submit"}],
            }
        )
        form = _make_form()
        form.get_definition = lambda: definition
        service_mock = _mock_service(monkeypatch, form)

        api = OpenApiWorkflowHumanInputFormApi()
        with app.test_request_context("/openapi/v1/apps/app-1/human-input-forms/tok-1"):
            resp = api.get.__handler__(
                api,
                _context(_make_account(), CallerKind.ACCOUNT),
                app_id="app-1",
                form_token="tok-1",
            )

        payload = json.loads(resp.get_data(as_text=True))
        assert payload["form_content"] == "Fill out the form"
        assert payload["resolved_default_values"] == {"field1": "default"}
        assert payload["user_actions"] == [{"id": "submit", "title": "Submit"}]
        service_mock.ensure_form_active.assert_called_once_with(form)

    def test_get_form_not_found(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        _mock_service(monkeypatch, None)

        api = OpenApiWorkflowHumanInputFormApi()
        with app.test_request_context("/openapi/v1/apps/app-1/human-input-forms/bad"):
            with pytest.raises(HumanInputFormNotFound):
                api.get.__handler__(
                    api,
                    _context(_make_account(), CallerKind.ACCOUNT),
                    app_id="app-1",
                    form_token="bad",
                )

    def test_get_form_wrong_app(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        _mock_service(monkeypatch, _make_form(app_id="other-app"))

        api = OpenApiWorkflowHumanInputFormApi()
        with app.test_request_context("/openapi/v1/apps/app-1/human-input-forms/tok-1"):
            with pytest.raises(HumanInputFormNotFound):
                api.get.__handler__(
                    api,
                    _context(_make_account(), CallerKind.ACCOUNT),
                    app_id="app-1",
                    form_token="tok-1",
                )

    def test_get_form_wrong_surface(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        _mock_service(monkeypatch, _make_form(recipient_type=RecipientType.CONSOLE))

        api = OpenApiWorkflowHumanInputFormApi()
        with app.test_request_context("/openapi/v1/apps/app-1/human-input-forms/tok-1"):
            with pytest.raises(RecipientSurfaceMismatch):
                api.get.__handler__(
                    api,
                    _context(_make_account(), CallerKind.ACCOUNT),
                    app_id="app-1",
                    form_token="tok-1",
                )


class TestOpenApiHumanInputFormPost:
    def test_post_account_caller_uses_user_id(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        service_mock = _mock_service(monkeypatch, _make_form())

        api = OpenApiWorkflowHumanInputFormSubmitApi()
        with app.test_request_context(
            "/openapi/v1/apps/app-1/human-input-forms/tok-1:submit",
            method="POST",
            json={"action": "approve", "inputs": {"field1": "val"}},
        ):
            result = api.post.__handler__(
                api,
                _context(_make_account("acct-42"), CallerKind.ACCOUNT),
                app_id="app-1",
                form_token="tok-1",
                body=HumanInputFormSubmitPayload(action="approve", inputs={"field1": "val"}),
            )

        service_mock.submit_form_by_token.assert_called_once_with(
            recipient_type=RecipientType.STANDALONE_WEB_APP,
            form_token="tok-1",
            selected_action_id="approve",
            form_data={"field1": "val"},
            submission_user_id="acct-42",
            submission_end_user_id=None,
        )
        assert result == FormSubmitResponse()

    def test_post_end_user_caller_uses_end_user_id(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        service_mock = _mock_service(monkeypatch, _make_form())

        api = OpenApiWorkflowHumanInputFormSubmitApi()
        with app.test_request_context(
            "/openapi/v1/apps/app-1/human-input-forms/tok-1:submit",
            method="POST",
            json={"action": "approve", "inputs": {}},
        ):
            result = api.post.__handler__(
                api,
                _context(_make_end_user("eu-7"), CallerKind.END_USER),
                app_id="app-1",
                form_token="tok-1",
                body=HumanInputFormSubmitPayload(action="approve", inputs={}),
            )

        service_mock.submit_form_by_token.assert_called_once_with(
            recipient_type=RecipientType.STANDALONE_WEB_APP,
            form_token="tok-1",
            selected_action_id="approve",
            form_data={},
            submission_user_id=None,
            submission_end_user_id="eu-7",
        )
        assert result == FormSubmitResponse()

    def test_post_standalone_web_app_recipient_submits(self, app: Flask, monkeypatch: pytest.MonkeyPatch):
        service_mock = _mock_service(monkeypatch, _make_form(recipient_type=RecipientType.STANDALONE_WEB_APP))

        api = OpenApiWorkflowHumanInputFormSubmitApi()
        with app.test_request_context(
            "/openapi/v1/apps/app-1/human-input-forms/tok-1:submit",
            method="POST",
            json={"action": "approve", "inputs": {}},
        ):
            result = api.post.__handler__(
                api,
                _context(_make_end_user("anyone"), CallerKind.END_USER),
                app_id="app-1",
                form_token="tok-1",
                body=HumanInputFormSubmitPayload(action="approve", inputs={}),
            )

        service_mock.submit_form_by_token.assert_called_once()
        assert result == FormSubmitResponse()

    def test_post_rejects_invalid_body_with_422(self, app: Flask):
        """Malformed body → 422 via @accepts, before the handler is reached."""
        api = OpenApiWorkflowHumanInputFormSubmitApi()

        with app.test_request_context(
            "/openapi/v1/apps/app-1/human-input-forms/tok-1:submit",
            method="POST",
            json={"inputs": {"field1": "val"}},  # missing required "action"
        ):
            with pytest.raises(UnprocessableEntity):
                api.post.__wrapped__(api, ctx=None, app_id="app-1", form_token="tok-1")
