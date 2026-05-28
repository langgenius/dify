"""Tests for openapi human input form endpoints."""

from __future__ import annotations

import json
import sys
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from werkzeug.exceptions import NotFound

from controllers.openapi.auth.data import AuthData
from libs.oauth_bearer import Scope, TokenType
from models.human_input import RecipientType


def _make_auth_data(app_model, caller, caller_kind):
    return AuthData.model_construct(
        token_type=TokenType.OAUTH_ACCOUNT,
        account_id=uuid.uuid4(),
        token_hash="test",
        scopes=frozenset({Scope.FULL}),
        app=app_model,
        caller=caller,
        caller_kind=caller_kind,
    )


class TestOpenApiHumanInputFormGet:
    def test_get_success(self, app, bypass_pipeline, monkeypatch):
        from controllers.openapi.human_input_form import OpenApiWorkflowHumanInputFormApi

        definition = SimpleNamespace(
            model_dump=lambda: {
                "rendered_content": "Fill out the form",
                "inputs": [{"output_variable_name": "field1"}],
                "default_values": {"field1": "default"},
                "user_actions": [{"id": "submit", "title": "Submit"}],
            }
        )
        form = SimpleNamespace(
            app_id="app-1",
            tenant_id="tenant-1",
            recipient_type=RecipientType.STANDALONE_WEB_APP,
            expiration_time=datetime(2099, 1, 1, tzinfo=UTC),
            get_definition=lambda: definition,
        )
        service_mock = Mock()
        service_mock.get_form_by_token.return_value = form
        service_mock.ensure_form_active = Mock()

        module = sys.modules["controllers.openapi.human_input_form"]
        monkeypatch.setattr(module, "HumanInputService", lambda _engine: service_mock)
        monkeypatch.setattr(module, "db", SimpleNamespace(engine=object()))

        api = OpenApiWorkflowHumanInputFormApi()
        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1")
        caller = SimpleNamespace(id="acct-1")

        with app.test_request_context("/openapi/v1/apps/app-1/form/human_input/tok-1"):
            resp = api.get.__wrapped__(
                api,
                app_id="app-1",
                form_token="tok-1",
                auth_data=_make_auth_data(app_model, caller, "account"),
            )

        payload = json.loads(resp.get_data(as_text=True))
        assert payload["form_content"] == "Fill out the form"
        assert payload["resolved_default_values"] == {"field1": "default"}
        assert payload["user_actions"] == [{"id": "submit", "title": "Submit"}]
        service_mock.ensure_form_active.assert_called_once_with(form)

    def test_get_form_not_found(self, app, bypass_pipeline, monkeypatch):
        from controllers.openapi.human_input_form import OpenApiWorkflowHumanInputFormApi

        service_mock = Mock()
        service_mock.get_form_by_token.return_value = None
        module = sys.modules["controllers.openapi.human_input_form"]
        monkeypatch.setattr(module, "HumanInputService", lambda _engine: service_mock)
        monkeypatch.setattr(module, "db", SimpleNamespace(engine=object()))

        api = OpenApiWorkflowHumanInputFormApi()
        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1")
        caller = SimpleNamespace(id="acct-1")

        with app.test_request_context("/openapi/v1/apps/app-1/form/human_input/bad"):
            with pytest.raises(NotFound):
                api.get.__wrapped__(
                    api,
                    app_id="app-1",
                    form_token="bad",
                    auth_data=_make_auth_data(app_model, caller, "account"),
                )

    def test_get_form_wrong_app(self, app, bypass_pipeline, monkeypatch):
        from controllers.openapi.human_input_form import OpenApiWorkflowHumanInputFormApi

        form = SimpleNamespace(
            app_id="other-app", tenant_id="tenant-1", expiration_time=datetime(2099, 1, 1, tzinfo=UTC)
        )
        service_mock = Mock()
        service_mock.get_form_by_token.return_value = form
        module = sys.modules["controllers.openapi.human_input_form"]
        monkeypatch.setattr(module, "HumanInputService", lambda _engine: service_mock)
        monkeypatch.setattr(module, "db", SimpleNamespace(engine=object()))

        api = OpenApiWorkflowHumanInputFormApi()
        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1")
        caller = SimpleNamespace(id="acct-1")

        with app.test_request_context("/openapi/v1/apps/app-1/form/human_input/tok-1"):
            with pytest.raises(NotFound):
                api.get.__wrapped__(
                    api,
                    app_id="app-1",
                    form_token="tok-1",
                    auth_data=_make_auth_data(app_model, caller, "account"),
                )

    def test_get_form_wrong_surface(self, app, bypass_pipeline, monkeypatch):
        from controllers.openapi.human_input_form import OpenApiWorkflowHumanInputFormApi

        form = SimpleNamespace(
            app_id="app-1",
            tenant_id="tenant-1",
            recipient_type=RecipientType.CONSOLE,
            expiration_time=datetime(2099, 1, 1, tzinfo=UTC),
        )
        service_mock = Mock()
        service_mock.get_form_by_token.return_value = form
        module = sys.modules["controllers.openapi.human_input_form"]
        monkeypatch.setattr(module, "HumanInputService", lambda _engine: service_mock)
        monkeypatch.setattr(module, "db", SimpleNamespace(engine=object()))

        api = OpenApiWorkflowHumanInputFormApi()
        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1")
        caller = SimpleNamespace(id="acct-1")

        with app.test_request_context("/openapi/v1/apps/app-1/form/human_input/tok-1"):
            with pytest.raises(NotFound):
                api.get.__wrapped__(
                    api,
                    app_id="app-1",
                    form_token="tok-1",
                    auth_data=_make_auth_data(app_model, caller, "account"),
                )


class TestOpenApiHumanInputFormPost:
    def _make_form(self, app_id="app-1", recipient_type=RecipientType.STANDALONE_WEB_APP):
        return SimpleNamespace(
            app_id=app_id,
            tenant_id="tenant-1",
            recipient_type=recipient_type,
            expiration_time=datetime(2099, 1, 1, tzinfo=UTC),
        )

    def test_post_account_caller_uses_user_id(self, app, bypass_pipeline, monkeypatch):
        from controllers.openapi.human_input_form import OpenApiWorkflowHumanInputFormApi

        form = self._make_form()
        service_mock = Mock()
        service_mock.get_form_by_token.return_value = form

        module = sys.modules["controllers.openapi.human_input_form"]
        monkeypatch.setattr(module, "HumanInputService", lambda _engine: service_mock)
        monkeypatch.setattr(module, "db", SimpleNamespace(engine=object()))

        api = OpenApiWorkflowHumanInputFormApi()
        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1")
        caller = SimpleNamespace(id="acct-42")

        with app.test_request_context(
            "/openapi/v1/apps/app-1/form/human_input/tok-1",
            method="POST",
            json={"action": "approve", "inputs": {"field1": "val"}},
        ):
            result = api.post.__wrapped__(
                api,
                app_id="app-1",
                form_token="tok-1",
                auth_data=_make_auth_data(app_model, caller, "account"),
            )

        service_mock.submit_form_by_token.assert_called_once_with(
            recipient_type=RecipientType.STANDALONE_WEB_APP,
            form_token="tok-1",
            selected_action_id="approve",
            form_data={"field1": "val"},
            submission_user_id="acct-42",
            submission_end_user_id=None,
        )
        assert result == ({}, 200)

    def test_post_end_user_caller_uses_end_user_id(self, app, bypass_pipeline, monkeypatch):
        from controllers.openapi.human_input_form import OpenApiWorkflowHumanInputFormApi

        form = self._make_form()
        service_mock = Mock()
        service_mock.get_form_by_token.return_value = form

        module = sys.modules["controllers.openapi.human_input_form"]
        monkeypatch.setattr(module, "HumanInputService", lambda _engine: service_mock)
        monkeypatch.setattr(module, "db", SimpleNamespace(engine=object()))

        api = OpenApiWorkflowHumanInputFormApi()
        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1")
        caller = SimpleNamespace(id="eu-7")

        with app.test_request_context(
            "/openapi/v1/apps/app-1/form/human_input/tok-1",
            method="POST",
            json={"action": "approve", "inputs": {}},
        ):
            result = api.post.__wrapped__(
                api,
                app_id="app-1",
                form_token="tok-1",
                auth_data=_make_auth_data(app_model, caller, "end_user"),
            )

        service_mock.submit_form_by_token.assert_called_once_with(
            recipient_type=RecipientType.STANDALONE_WEB_APP,
            form_token="tok-1",
            selected_action_id="approve",
            form_data={},
            submission_user_id=None,
            submission_end_user_id="eu-7",
        )
        assert result == ({}, 200)
