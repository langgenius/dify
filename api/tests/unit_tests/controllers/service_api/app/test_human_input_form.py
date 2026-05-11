"""Unit tests for Service API human input form endpoints."""

from __future__ import annotations

import json
import sys
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from werkzeug.exceptions import NotFound

from controllers.service_api.app.human_input_form import WorkflowHumanInputFormApi
from models.human_input import RecipientType
from tests.unit_tests.controllers.service_api.conftest import _unwrap


class TestWorkflowHumanInputFormApi:
    def test_get_success(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        definition = SimpleNamespace(
            model_dump=lambda: {
                "rendered_content": "Rendered form content",
                "inputs": [{"output_variable_name": "name"}],
                "default_values": {"name": "Alice", "age": 30, "meta": {"k": "v"}},
                "user_actions": [{"id": "approve", "title": "Approve"}],
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
        workflow_module = sys.modules["controllers.service_api.app.human_input_form"]
        monkeypatch.setattr(workflow_module, "HumanInputService", lambda _engine: service_mock)
        monkeypatch.setattr(workflow_module, "db", SimpleNamespace(engine=object()))

        api = WorkflowHumanInputFormApi()
        handler = _unwrap(api.get)
        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1")

        with app.test_request_context("/form/human_input/token-1", method="GET"):
            response = handler(api, app_model=app_model, form_token="token-1")

        payload = json.loads(response.get_data(as_text=True))
        assert payload == {
            "form_content": "Rendered form content",
            "inputs": [{"output_variable_name": "name"}],
            "resolved_default_values": {"name": "Alice", "age": "30", "meta": '{"k": "v"}'},
            "user_actions": [{"id": "approve", "title": "Approve"}],
            "expiration_time": int(form.expiration_time.timestamp()),
        }
        service_mock.get_form_by_token.assert_called_once_with("token-1")
        service_mock.ensure_form_active.assert_called_once_with(form)

    def test_get_form_not_in_app(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        form = SimpleNamespace(
            app_id="another-app",
            tenant_id="tenant-1",
            expiration_time=datetime(2099, 1, 1, tzinfo=UTC),
        )
        service_mock = Mock()
        service_mock.get_form_by_token.return_value = form
        workflow_module = sys.modules["controllers.service_api.app.human_input_form"]
        monkeypatch.setattr(workflow_module, "HumanInputService", lambda _engine: service_mock)
        monkeypatch.setattr(workflow_module, "db", SimpleNamespace(engine=object()))

        api = WorkflowHumanInputFormApi()
        handler = _unwrap(api.get)
        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1")

        with app.test_request_context("/form/human_input/token-1", method="GET"):
            with pytest.raises(NotFound):
                handler(api, app_model=app_model, form_token="token-1")

    @pytest.mark.parametrize(
        "recipient_type",
        [
            RecipientType.CONSOLE,
            RecipientType.BACKSTAGE,
            RecipientType.EMAIL_MEMBER,
            RecipientType.EMAIL_EXTERNAL,
        ],
    )
    def test_get_rejects_non_service_api_recipient_types(
        self, app, monkeypatch: pytest.MonkeyPatch, recipient_type: RecipientType
    ) -> None:
        form = SimpleNamespace(
            app_id="app-1",
            tenant_id="tenant-1",
            recipient_type=recipient_type,
            expiration_time=datetime(2099, 1, 1, tzinfo=UTC),
        )
        service_mock = Mock()
        service_mock.get_form_by_token.return_value = form
        workflow_module = sys.modules["controllers.service_api.app.human_input_form"]
        monkeypatch.setattr(workflow_module, "HumanInputService", lambda _engine: service_mock)
        monkeypatch.setattr(workflow_module, "db", SimpleNamespace(engine=object()))

        api = WorkflowHumanInputFormApi()
        handler = _unwrap(api.get)
        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1")

        with app.test_request_context("/form/human_input/token-1", method="GET"):
            with pytest.raises(NotFound):
                handler(api, app_model=app_model, form_token="token-1")

        service_mock.ensure_form_active.assert_not_called()

    def test_post_success(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        form = SimpleNamespace(
            app_id="app-1",
            tenant_id="tenant-1",
            recipient_type=RecipientType.STANDALONE_WEB_APP,
        )
        service_mock = Mock()
        service_mock.get_form_by_token.return_value = form
        workflow_module = sys.modules["controllers.service_api.app.human_input_form"]
        monkeypatch.setattr(workflow_module, "HumanInputService", lambda _engine: service_mock)
        monkeypatch.setattr(workflow_module, "db", SimpleNamespace(engine=object()))

        api = WorkflowHumanInputFormApi()
        handler = _unwrap(api.post)
        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1")
        end_user = SimpleNamespace(id="end-user-1")

        with app.test_request_context(
            "/form/human_input/token-1",
            method="POST",
            json={"inputs": {"name": "Alice"}, "action": "approve", "user": "external-1"},
        ):
            response, status = handler(api, app_model=app_model, end_user=end_user, form_token="token-1")

        assert response == {}
        assert status == 200
        service_mock.submit_form_by_token.assert_called_once_with(
            recipient_type=RecipientType.STANDALONE_WEB_APP,
            form_token="token-1",
            selected_action_id="approve",
            form_data={"name": "Alice"},
            submission_end_user_id="end-user-1",
        )

    @pytest.mark.parametrize(
        "recipient_type",
        [
            RecipientType.CONSOLE,
            RecipientType.BACKSTAGE,
            RecipientType.EMAIL_MEMBER,
            RecipientType.EMAIL_EXTERNAL,
        ],
    )
    def test_post_rejects_non_service_api_recipient_types(
        self, app, monkeypatch: pytest.MonkeyPatch, recipient_type: RecipientType
    ) -> None:
        form = SimpleNamespace(
            app_id="app-1",
            tenant_id="tenant-1",
            recipient_type=recipient_type,
        )
        service_mock = Mock()
        service_mock.get_form_by_token.return_value = form
        workflow_module = sys.modules["controllers.service_api.app.human_input_form"]
        monkeypatch.setattr(workflow_module, "HumanInputService", lambda _engine: service_mock)
        monkeypatch.setattr(workflow_module, "db", SimpleNamespace(engine=object()))

        api = WorkflowHumanInputFormApi()
        handler = _unwrap(api.post)
        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1")
        end_user = SimpleNamespace(id="end-user-1")

        with app.test_request_context(
            "/form/human_input/token-1",
            method="POST",
            json={"inputs": {"name": "Alice"}, "action": "approve", "user": "external-1"},
        ):
            with pytest.raises(NotFound):
                handler(api, app_model=app_model, end_user=end_user, form_token="token-1")

        service_mock.submit_form_by_token.assert_not_called()
