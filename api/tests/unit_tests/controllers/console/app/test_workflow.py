"""Transport contracts; workflow behavior is tested at the use-case and adapter boundaries."""

import inspect
from dataclasses import dataclass
from datetime import UTC, datetime
from unittest.mock import MagicMock, Mock, create_autospec
from uuid import UUID

import pytest
from flask import Flask, Response
from flask_restx import Resource
from pydantic import BaseModel, JsonValue, ValidationError
from werkzeug.exceptions import HTTPException

from controllers.common.errors import InvalidArgumentError, InvalidRequestError, NotFoundError
from controllers.console.app import workflow as controller
from controllers.console.app.error import DraftWorkflowNotSync
from graphon.variables.exc import VariableError
from libs.external_api import ExternalApi
from machinery.context import RequestContext
from services.agent.workflow_contracts import WorkflowAgentBindingStore
from services.errors.app import IsDraftWorkflowError, WorkflowHashNotEqualError, WorkflowNotFoundError
from services.workflow.console_service import ConsoleWorkflowService
from services.workflow.contracts import WorkflowChange, WorkflowOwner, WorkflowPublication, WorkflowTriggerError

CONTEXT = RequestContext("request-1", "trace-1", "account-1", "tenant-1")
APP_ID = UUID("00000000-0000-0000-0000-000000000001")


@dataclass
class Services:
    console_workflows: ConsoleWorkflowService[WorkflowAgentBindingStore]


@pytest.fixture(name="workflows")
def workflow_use_cases(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    use_cases = create_autospec(ConsoleWorkflowService, instance=True, spec_set=True)
    monkeypatch.setattr(controller, "application_services", lambda: Services(use_cases))
    return use_cases


def invoke(resource: type[Resource], method: str = "post", *args: object, **kwargs: object) -> object:
    api = resource()
    return inspect.unwrap(getattr(api, method))(api, *args, request_context=CONTEXT, app_id=APP_ID, **kwargs)


@pytest.mark.parametrize("content_type", ["application/json", "text/plain"])
def test_sync_parses_transport_and_preserves_patch(app: Flask, workflows: Mock, content_type: str) -> None:
    workflows.sync.return_value = WorkflowChange("new-hash", datetime(2024, 1, 1, tzinfo=UTC))
    body: dict[str, JsonValue] = {
        "graph": {"nodes": []},
        "features": {},
        "hash": "old-hash",
        "_is_collaborative": True,
        "environment_variable_patch": {
            "environment_variables": [{"id": "env-1", "name": "KEY", "value_type": "secret", "value": "masked"}],
            "deleted_environment_variable_ids": ["env-2"],
        },
    }
    import json

    with app.test_request_context(method="POST", data=json.dumps(body), content_type=content_type):
        response = invoke(controller.DraftWorkflowApi)
    assert response == {"result": "success", "hash": "new-hash", "updated_at": 1704067200}
    context, app_id, command = workflows.sync.call_args.args
    assert (context, app_id) == (CONTEXT, str(APP_ID))
    assert command.is_collaborative is True
    assert command.unique_hash == "old-hash"
    patch = body["environment_variable_patch"]
    assert isinstance(patch, dict)
    assert command.environment_upserts == patch["environment_variables"]
    assert command.environment_deletions == ["env-2"]


@pytest.mark.parametrize(
    ("content_type", "data", "status"),
    [("application/xml", "x", 415), ("application/json", "[]", 400), ("text/plain", "invalid", 400)],
)
def test_sync_invalid_input_does_not_dispatch(
    app: Flask, workflows: Mock, content_type: str, data: str, status: int
) -> None:
    with app.test_request_context(method="POST", data=data, content_type=content_type):
        if status == 415:
            with pytest.raises(HTTPException) as error:
                invoke(controller.DraftWorkflowApi)
            assert error.value.code == status
        else:
            assert invoke(controller.DraftWorkflowApi) == ({"message": "Invalid JSON data"}, status)
    workflows.sync.assert_not_called()


@pytest.mark.parametrize(
    ("failure", "error_type"),
    [(WorkflowHashNotEqualError(), DraftWorkflowNotSync), (VariableError("bad variable"), InvalidArgumentError)],
)
def test_sync_domain_errors(app: Flask, workflows: Mock, failure: Exception, error_type: type[Exception]) -> None:
    workflows.sync.side_effect = failure
    with app.test_request_context(method="POST", json={"graph": {}, "features": {}}), pytest.raises(error_type):
        invoke(controller.DraftWorkflowApi)


@pytest.mark.parametrize(
    "patch",
    [
        {"environment_variables": [{"id": "same"}, {"id": "same"}]},
        {"environment_variables": [{"name": "missing-id"}]},
        {"environment_variables": [{"id": "same"}], "deleted_environment_variable_ids": ["same"]},
        {"deleted_environment_variable_ids": [""]},
    ],
)
def test_sync_rejects_ambiguous_variable_patch(patch: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        controller.SyncDraftWorkflowPayload.model_validate(
            {"graph": {}, "features": {}, "environment_variable_patch": patch}
        )


def test_sync_rejects_removed_full_environment_payload() -> None:
    with pytest.raises(ValidationError):
        controller.SyncDraftWorkflowPayload.model_validate({"graph": {}, "features": {}, "environment_variables": []})


@pytest.mark.parametrize("warning", [None, "branch may be skipped"])
def test_publish_serializes_advisory(workflows: Mock, warning: str | None) -> None:
    workflows.publish.return_value = (WorkflowPublication(datetime(2024, 1, 1, tzinfo=UTC), "{}"), warning)
    response = invoke(controller.PublishedWorkflowApi, "post", controller.PublishWorkflowPayload())
    assert isinstance(response, dict)
    assert response["created_at"] == 1704067200
    assert response.get("warning") == warning
    assert ("warning" in response) is (warning is not None)
    workflows.publish.assert_called_once_with(CONTEXT, str(APP_ID), marked_name="", marked_comment="")


@pytest.mark.parametrize(
    ("failure", "error_type"),
    [
        (IsDraftWorkflowError(), InvalidRequestError),
        (WorkflowNotFoundError("missing"), NotFoundError),
        (ValueError("invalid graph"), InvalidRequestError),
    ],
)
def test_restore_error_contract(workflows: Mock, failure: Exception, error_type: type[Exception]) -> None:
    workflows.restore.side_effect = failure
    with pytest.raises(error_type):
        invoke(controller.DraftWorkflowRestoreApi, workflow_id="version")


@pytest.mark.parametrize(
    ("failure", "status", "code"),
    [(WorkflowNotFoundError("missing"), 404, "not_found"), (ValueError("invalid graph"), 400, "bad_request")],
)
def test_restore_domain_error_http_response(workflows: Mock, failure: Exception, status: int, code: str) -> None:
    from controllers.console import api as console_api

    workflows.restore.side_effect = failure
    app = Flask(__name__)
    app.config["RESTX_ERROR_404_HELP"] = False
    api = ExternalApi(app)
    api.error_handlers = console_api.error_handlers.copy()

    class Restore(Resource):
        def post(self) -> object:
            return invoke(controller.DraftWorkflowRestoreApi, workflow_id="version")

    api.add_resource(Restore, "/restore")
    response = app.test_client().post("/restore")
    assert response.status_code == status
    assert response.json == {"code": code, "status": status, "message": str(failure)}


def test_restore_serializes_change(workflows: Mock) -> None:
    workflows.restore.return_value = WorkflowChange("hash", datetime(2024, 1, 1, tzinfo=UTC))
    assert invoke(controller.DraftWorkflowRestoreApi, workflow_id="version") == {
        "result": "success",
        "hash": "hash",
        "updated_at": 1704067200,
    }


@pytest.mark.parametrize(
    ("resource", "payload", "kwargs"),
    [
        (controller.DraftWorkflowTriggerRunApi, controller.DraftWorkflowTriggerRunPayload(node_id="node"), {}),
        (controller.DraftWorkflowTriggerRunAllApi, controller.DraftWorkflowTriggerRunAllPayload(node_ids=["node"]), {}),
        (controller.DraftWorkflowTriggerNodeApi, None, {"node_id": "node"}),
    ],
)
def test_trigger_waiting_and_error_contract(
    workflows: Mock, resource: type[Resource], payload: BaseModel | None, kwargs: dict[str, str]
) -> None:
    args = (payload,) if payload is not None else ()
    workflows.trigger.return_value = None
    assert invoke(resource, "post", *args, **kwargs) == {"status": "waiting", "retry_in": 2000}
    workflows.trigger.side_effect = WorkflowTriggerError("plugin unavailable")
    assert invoke(resource, "post", *args, **kwargs) == ({"status": "error", "error": "plugin unavailable"}, 400)


@pytest.mark.parametrize(
    ("resource", "payload"),
    [
        (controller.DraftWorkflowRunApi, controller.DraftWorkflowRunPayload(inputs={})),
        (controller.AdvancedChatDraftWorkflowRunApi, controller.AdvancedChatWorkflowRunPayload(inputs={})),
    ],
)
def test_debug_run_passes_external_trace_and_stream(
    app: Flask, workflows: Mock, monkeypatch: pytest.MonkeyPatch, resource: type[Resource], payload: BaseModel
) -> None:
    workflows.generate.return_value = {"task_id": "task"}
    monkeypatch.setattr(controller, "get_external_trace_id", lambda request: "external-trace")
    with app.test_request_context(method="POST", json={}):
        response = invoke(resource, "post", payload)
        assert isinstance(response, Response)
        assert response.get_json() == {"task_id": "task"}
    assert workflows.generate.call_args.args[2]["external_trace_id"] == "external-trace"


def test_convert_delegates_permissions_result(workflows: Mock) -> None:
    result = {"new_app_id": "new-app", "permission_keys": ["app.acl.edit"]}
    workflows.convert.return_value = result
    assert invoke(controller.ConvertToWorkflowApi, "post", controller.ConvertToWorkflowPayload(name="Copy")) == result
    workflows.convert.assert_called_once_with(CONTEXT, str(APP_ID), {"name": "Copy"})


def test_update_empty_payload_does_not_dispatch(workflows: Mock) -> None:
    assert invoke(controller.WorkflowByIdApi, "patch", controller.WorkflowUpdatePayload(), workflow_id="version") == (
        {"message": "No valid fields to update"},
        400,
    )
    workflows.update.assert_not_called()


def test_delete_has_no_response_body(workflows: Mock) -> None:
    assert invoke(controller.WorkflowByIdApi, "delete", workflow_id="version") == (None, 204)
    workflows.delete.assert_called_once_with(CONTEXT, WorkflowOwner(str(APP_ID)), "version")


def test_online_users_normalization_and_response(workflows: Mock) -> None:
    workflows.online_users.return_value = [
        {"app_id": "a", "users": [{"user_id": "u", "username": "Name", "avatar": None}]}
    ]
    payload = controller.WorkflowOnlineUsersPayload(app_ids=[" a ", "", "a"])
    api = controller.WorkflowOnlineUsersApi()
    result = inspect.unwrap(api.post)(api, payload, CONTEXT)
    assert result == {"data": workflows.online_users.return_value}
    workflows.online_users.assert_called_once_with(CONTEXT, ["a"])
