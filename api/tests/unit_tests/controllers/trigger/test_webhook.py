from dataclasses import dataclass
from io import BytesIO
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import NotFound, RequestEntityTooLarge

import controllers.trigger.webhook as module
from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.file_access import DatabaseFileAccessController, FileAccessScope, bind_file_access_scope
from factories import file_factory
from models.enums import DEFAULT_END_USER_SESSION_ID, EndUserType
from models.model import EndUser
from models.trigger import WorkflowWebhookTrigger
from models.workflow import Workflow
from services.errors.app import QuotaExceededError
from tests.helpers.unit.model_factories import make_end_user, make_workflow


class _RequestStub:
    method = "POST"
    headers = {"x-test": "1"}
    args = {"a": "b"}


@dataclass(eq=False, repr=False)
class _AppScopedEndUserServicesStub:
    commands: object


class _ApplicationServicesStub:
    def __init__(self, commands: object) -> None:
        self.app_scoped_end_users = _AppScopedEndUserServicesStub(commands)


class _EndUserCommandsStub:
    def __init__(self, end_user: EndUser) -> None:
        self._end_user = end_user
        self.calls: list[tuple[EndUserType, str, str, str | None]] = []

    def get_or_create_end_user_by_type(
        self,
        type: EndUserType,
        tenant_id: str,
        app_id: str,
        user_id: str | None = None,
    ) -> EndUser:
        self.calls.append((type, tenant_id, app_id, user_id))
        return self._end_user


@pytest.fixture(autouse=True)
def mock_request():
    module.request = _RequestStub()


@pytest.fixture(autouse=True)
def mock_jsonify():
    module.jsonify = lambda payload: payload


@pytest.fixture(autouse=True)
def end_user_commands(monkeypatch: pytest.MonkeyPatch) -> object:
    commands = object()
    monkeypatch.setattr(module, "application_services", lambda: _ApplicationServicesStub(commands))
    return commands


def _webhook_trigger() -> WorkflowWebhookTrigger:
    return WorkflowWebhookTrigger(
        webhook_id="wh-1",
        tenant_id="tenant-1",
        app_id="app-1",
        node_id="node-1",
        created_by="account-1",
    )


def _workflow() -> Workflow:
    return make_workflow(workflow_id="workflow-1")


class TestPrepareWebhookExecution:
    @patch.object(module.WebhookService, "get_webhook_trigger_and_workflow")
    @patch.object(module.WebhookService, "extract_and_validate_webhook_data")
    def test_prepare_success(self, mock_extract, mock_get):
        webhook_trigger = _webhook_trigger()
        workflow = _workflow()
        mock_get.return_value = (webhook_trigger, workflow, "node_config")
        mock_extract.return_value = {"data": "ok"}

        result = module._prepare_webhook_execution("wh-1")

        assert result == (webhook_trigger, workflow, "node_config", {"data": "ok"}, None)

    @patch.object(module.WebhookService, "get_webhook_trigger_and_workflow")
    @patch.object(module.WebhookService, "extract_and_validate_webhook_data", side_effect=ValueError("bad"))
    def test_prepare_validation_error(self, mock_extract, mock_get):
        webhook_trigger = _webhook_trigger()
        workflow = _workflow()
        mock_get.return_value = (webhook_trigger, workflow, "node_config")

        trigger, workflow, node_config, webhook_data, error = module._prepare_webhook_execution("wh-1")

        assert error == "bad"
        assert webhook_data["method"] == "POST"

    @patch.object(module.WebhookService, "get_webhook_trigger_and_workflow")
    def test_prepare_stores_uploads_for_the_trigger_end_user_run(
        self, mock_get: MagicMock, app: Flask, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        node_config = {
            "data": {
                "method": "post",
                "content_type": "multipart/form-data",
                "body": [{"name": "chat_history_file", "type": "file", "required": True}],
            }
        }
        mock_get.return_value = (_webhook_trigger(), _workflow(), node_config)
        trigger_end_user = make_end_user(
            end_user_id="trigger-end-user-1",
            tenant_id="tenant-1",
            app_id="app-1",
            end_user_type=EndUserType.TRIGGER,
            session_id=DEFAULT_END_USER_SESSION_ID,
        )
        end_users = _EndUserCommandsStub(trigger_end_user)
        monkeypatch.setattr(module, "application_services", lambda: _ApplicationServicesStub(end_users))
        monkeypatch.setattr("core.tools.tool_file_manager.storage.save", lambda *_args: None)

        with app.test_request_context(
            "/triggers/webhook/wh-1",
            method="POST",
            data={"chat_history_file": (BytesIO(b"# chat"), "chat.md", "text/markdown")},
            content_type="multipart/form-data",
        ):
            _, _, _, webhook_data, error = module._prepare_webhook_execution("wh-1")

        assert error is None
        tool_file_id = webhook_data["files"]["chat_history_file"]["related_id"]
        # The async run executes as the trigger end user, whose scope only loads tool files it owns.
        run_scope = FileAccessScope(
            tenant_id="tenant-1",
            user_id=trigger_end_user.id,
            user_from=UserFrom.END_USER,
            invoke_from=InvokeFrom.SERVICE_API,
        )
        with bind_file_access_scope(run_scope):
            file = file_factory.build_from_mapping(
                mapping={"transfer_method": "tool_file", "tool_file_id": tool_file_id},
                tenant_id="tenant-1",
                access_controller=DatabaseFileAccessController(),
            )
        assert file.related_id == tool_file_id
        assert end_users.calls == [(EndUserType.TRIGGER, "tenant-1", "app-1", None)]


class TestHandleWebhook:
    @patch.object(module.WebhookService, "get_webhook_trigger_and_workflow")
    @patch.object(module.WebhookService, "extract_and_validate_webhook_data")
    @patch.object(module.WebhookService, "trigger_workflow_execution")
    @patch.object(module.WebhookService, "generate_webhook_response")
    def test_success(
        self,
        mock_generate,
        mock_trigger,
        mock_extract,
        mock_get,
        end_user_commands,
    ):
        mock_get.return_value = (_webhook_trigger(), _workflow(), "node_config")
        mock_extract.return_value = {"input": "x"}
        mock_generate.return_value = ({"ok": True}, 200)

        response, status = module.handle_webhook("wh-1")

        assert status == 200
        assert response["ok"] is True
        mock_trigger.assert_called_once()
        assert mock_trigger.call_args.kwargs["end_users"] is end_user_commands

    @patch.object(module.WebhookService, "get_webhook_trigger_and_workflow")
    @patch.object(module.WebhookService, "extract_and_validate_webhook_data", side_effect=ValueError("bad"))
    def test_bad_request(self, mock_extract, mock_get):
        mock_get.return_value = (_webhook_trigger(), _workflow(), "node_config")

        response, status = module.handle_webhook("wh-1")

        assert status == 400
        assert response["error"] == "Bad Request"

    @patch.object(module.WebhookService, "get_webhook_trigger_and_workflow")
    @patch.object(module.WebhookService, "extract_and_validate_webhook_data")
    @patch.object(
        module.WebhookService,
        "trigger_workflow_execution",
        side_effect=QuotaExceededError(feature="trigger", tenant_id="tenant-1", required=1),
    )
    def test_quota_exceeded(self, mock_trigger, mock_extract, mock_get):
        mock_get.return_value = (_webhook_trigger(), _workflow(), "node_config")
        mock_extract.return_value = {"input": "x"}

        response, status = module.handle_webhook("wh-1")

        assert status == 429
        assert response == {
            "error": "Too Many Requests",
            "message": "Trigger event quota exceeded. Please upgrade your plan.",
        }

    @patch.object(module.WebhookService, "get_webhook_trigger_and_workflow")
    @patch.object(module.WebhookService, "extract_and_validate_webhook_data")
    @patch.object(
        module.WebhookService,
        "trigger_workflow_execution",
        side_effect=QuotaExceededError(feature="workflow", tenant_id="tenant-1", required=1),
    )
    def test_workflow_quota_exceeded(self, mock_trigger, mock_extract, mock_get):
        mock_get.return_value = (_webhook_trigger(), _workflow(), "node_config")
        mock_extract.return_value = {"input": "x"}

        response, status = module.handle_webhook("wh-1")

        assert status == 429
        assert response == {
            "error": "Too Many Requests",
            "message": "Workflow execution quota exceeded. Please upgrade your plan.",
        }

    @patch.object(
        module.WebhookService,
        "get_webhook_trigger_and_workflow",
        side_effect=QuotaExceededError(feature="trigger", tenant_id="tenant-1", required=1),
    )
    def test_rate_limited(self, mock_get):
        response, status = module.handle_webhook("wh-1")

        assert status == 429
        assert response == {
            "error": "Too Many Requests",
            "message": "Trigger event quota exceeded. Please upgrade your plan.",
        }

    @patch.object(module.WebhookService, "get_webhook_trigger_and_workflow", side_effect=ValueError("missing"))
    def test_value_error_not_found(self, mock_get):
        response = module.handle_webhook("wh-1")
        assert response.status_code == 404
        assert response.data == NotFound().get_body().encode()

    @patch.object(module.WebhookService, "get_webhook_trigger_and_workflow", side_effect=RequestEntityTooLarge())
    def test_request_entity_too_large(self, mock_get):
        with pytest.raises(RequestEntityTooLarge):
            module.handle_webhook("wh-1")

    @patch.object(module.WebhookService, "get_webhook_trigger_and_workflow", side_effect=Exception("boom"))
    def test_internal_error(self, mock_get):
        response, status = module.handle_webhook("wh-1")

        assert status == 500
        assert response["error"] == "Internal server error"


class TestHandleWebhookDebug:
    @patch.object(module.WebhookService, "get_webhook_trigger_and_workflow")
    @patch.object(module.WebhookService, "extract_and_validate_webhook_data")
    @patch.object(module.WebhookService, "build_workflow_inputs", return_value={"x": 1})
    @patch.object(module.TriggerDebugEventBus, "dispatch", return_value=0)
    def test_debug_requires_active_listener(
        self,
        mock_dispatch,
        mock_build_inputs,
        mock_extract,
        mock_get,
    ):
        webhook_trigger = _webhook_trigger()
        mock_get.return_value = (webhook_trigger, None, "node_config")
        mock_extract.return_value = {"method": "POST"}

        response, status = module.handle_webhook_debug("wh-1")

        assert status == 409
        assert response["error"] == "No active debug listener"
        assert response["message"] == (
            "The webhook debug URL only works while the Variable Inspector is listening. "
            "Use the published webhook URL to execute the workflow in Celery."
        )
        assert response["execution_url"] == webhook_trigger.webhook_url
        mock_dispatch.assert_called_once()

    @patch.object(module.WebhookService, "get_webhook_trigger_and_workflow")
    @patch.object(module.WebhookService, "extract_and_validate_webhook_data")
    @patch.object(module.WebhookService, "build_workflow_inputs", return_value={"x": 1})
    @patch.object(module.TriggerDebugEventBus, "dispatch", return_value=1)
    @patch.object(module.WebhookService, "generate_webhook_response")
    def test_debug_success(
        self,
        mock_generate,
        mock_dispatch,
        mock_build_inputs,
        mock_extract,
        mock_get,
    ):
        mock_get.return_value = (_webhook_trigger(), None, "node_config")
        mock_extract.return_value = {"method": "POST"}
        mock_generate.return_value = ({"ok": True}, 200)

        response, status = module.handle_webhook_debug("wh-1")

        assert status == 200
        assert response["ok"] is True
        mock_dispatch.assert_called_once()

    @patch.object(module.WebhookService, "get_webhook_trigger_and_workflow")
    @patch.object(module.WebhookService, "extract_and_validate_webhook_data", side_effect=ValueError("bad"))
    def test_debug_bad_request(self, mock_extract, mock_get):
        mock_get.return_value = (_webhook_trigger(), None, "node_config")

        response, status = module.handle_webhook_debug("wh-1")

        assert status == 400
        assert response["error"] == "Bad Request"

    @patch.object(module.WebhookService, "get_webhook_trigger_and_workflow", side_effect=ValueError("missing"))
    def test_debug_not_found(self, mock_get):
        response = module.handle_webhook_debug("wh-1")
        assert response.status_code == 404
        assert response.data == NotFound().get_body().encode()

    @patch.object(module.WebhookService, "get_webhook_trigger_and_workflow", side_effect=RequestEntityTooLarge())
    def test_debug_request_entity_too_large(self, mock_get):
        with pytest.raises(RequestEntityTooLarge):
            module.handle_webhook_debug("wh-1")

    @patch.object(module.WebhookService, "get_webhook_trigger_and_workflow", side_effect=Exception("boom"))
    def test_debug_internal_error(self, mock_get):
        response, status = module.handle_webhook_debug("wh-1")

        assert status == 500
        assert response["error"] == "Internal server error"
