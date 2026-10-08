"""Transport delegates all three scopes without ORM objects or Sessions."""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from inspect import unwrap
from types import MethodType, ModuleType
from typing import Literal
from uuid import UUID

import pytest
from flask import Flask, Response
from flask_restx import Resource

from controllers.console import api as console_api
from controllers.console.app import workflow_draft_variable as app
from controllers.console.app import workflow_variable_admission as admission
from controllers.console.datasets.rag_pipeline import rag_pipeline_draft_variable as pipeline
from controllers.console.snippets import snippet_workflow_draft_variable as snippet
from controllers.console.wraps import RBACPermission
from graphon.variables import StringSegment
from libs.external_api import ExternalApi
from machinery.context import RequestContext
from services.workflow.contracts import DraftWorkflowMissingError, WorkflowOwner
from services.workflow.variable_contracts import (
    ConsoleVariableList,
    DraftVariableChangedError,
    DraftVariableNotFoundError,
    DraftVariableOwnerNotFoundError,
    DraftVariableView,
    InvalidDraftVariableError,
)
from tests.unit_tests.controllers.rbac_introspection import rbac_checks

CONTEXT = RequestContext("request", None, "account-1", "tenant-1")
OWNER_ID = UUID("00000000-0000-0000-0000-000000000001")
VARIABLE_ID = UUID("00000000-0000-0000-0000-000000000002")
VARIABLE = DraftVariableView(
    str(VARIABLE_ID),
    "node",
    "answer",
    "",
    ["node", "answer"],
    "string",
    False,
    True,
    False,
    StringSegment(value="answer"),
    None,
)

type RecordedCall = tuple[
    str,
    RequestContext,
    WorkflowOwner | str,
    tuple[object, ...],
    dict[str, object],
]


@dataclass
class Variables:
    calls: list[RecordedCall] = field(default_factory=list)

    def record(
        self,
        op: str,
        context: RequestContext,
        owner: WorkflowOwner | str,
        *args: object,
        **kwargs: object,
    ) -> None:
        self.calls.append((op, context, owner, args, kwargs))

    def list_variables(
        self, context: RequestContext, owner: WorkflowOwner, *, page: int, limit: int
    ) -> ConsoleVariableList:
        self.record("list_variables", context, owner, page=page, limit=limit)
        return ConsoleVariableList([VARIABLE], 1)

    def node(self, context: RequestContext, owner: WorkflowOwner, node_id: str) -> ConsoleVariableList:
        self.record("node", context, owner, node_id)
        return ConsoleVariableList([VARIABLE])

    def system(self, context: RequestContext, owner: WorkflowOwner) -> ConsoleVariableList:
        self.record("system", context, owner)
        return ConsoleVariableList([])

    def conversation(self, context: RequestContext, owner: WorkflowOwner) -> ConsoleVariableList:
        self.record("conversation", context, owner)
        return ConsoleVariableList([])

    def environment(self, context: RequestContext, owner: WorkflowOwner) -> list[dict[str, object]]:
        self.record("environment", context, owner)
        return []

    def get(self, context: RequestContext, owner: WorkflowOwner, variable_id: str) -> DraftVariableView:
        self.record("get", context, owner, variable_id)
        return VARIABLE

    def patch(
        self,
        context: RequestContext,
        owner: WorkflowOwner,
        variable_id: str,
        *,
        name: str | None,
        value: object,
    ) -> DraftVariableView:
        self.record("patch", context, owner, variable_id, name=name, value=value)
        return VARIABLE

    def reset(self, context: RequestContext, owner: WorkflowOwner, variable_id: str) -> DraftVariableView | None:
        self.record("reset", context, owner, variable_id)
        return None

    def delete(self, context: RequestContext, owner: WorkflowOwner, variable_id: str) -> None:
        self.record("delete", context, owner, variable_id)

    def delete_all(self, context: RequestContext, owner: WorkflowOwner) -> None:
        self.record("delete_all", context, owner)

    def delete_node(self, context: RequestContext, owner: WorkflowOwner, node_id: str) -> None:
        self.record("delete_node", context, owner, node_id)

    def update_conversation(self, context: RequestContext, app_id: str, values: Sequence[dict[str, object]]) -> None:
        self.record("update_conversation", context, app_id, values)

    def update_environment(
        self,
        context: RequestContext,
        app_id: str,
        values: Sequence[dict[str, object]],
        *,
        deleted_ids: Sequence[str] | None,
    ) -> None:
        self.record("update_environment", context, app_id, values, deleted_ids=deleted_ids)


@dataclass
class Services:
    console_workflow_variables: Variables


type EndpointCase = tuple[
    ModuleType,
    Literal["app", "pipeline", "snippet"],
    MethodType,
    str,
    object | None,
    Literal["", "node", "variable"],
]


def response_mapping(value: object) -> dict[str, object]:
    assert isinstance(value, Mapping)
    return {key: item for key, item in value.items() if isinstance(key, str)}


ENDPOINTS: list[EndpointCase] = [
    (app, "app", app.WorkflowVariableCollectionApi().get, "list_variables", app.WorkflowDraftVariableListQuery(), ""),
    (app, "app", app.WorkflowVariableCollectionApi().delete, "delete_all", None, ""),
    (app, "app", app.NodeVariableCollectionApi().get, "node", None, "node"),
    (app, "app", app.NodeVariableCollectionApi().delete, "delete_node", None, "node"),
    (app, "app", app.VariableApi().get, "get", None, "variable"),
    (app, "app", app.VariableApi().patch, "patch", app.WorkflowDraftVariableUpdatePayload(), "variable"),
    (app, "app", app.VariableApi().delete, "delete", None, "variable"),
    (app, "app", app.VariableResetApi().put, "reset", None, "variable"),
    (app, "app", app.ConversationVariableCollectionApi().get, "conversation", None, ""),
    (
        app,
        "app",
        app.ConversationVariableCollectionApi().post,
        "update_conversation",
        app.ConversationVariableUpdatePayload(conversation_variables=[]),
        "",
    ),
    (app, "app", app.SystemVariableCollectionApi().get, "system", None, ""),
    (app, "app", app.EnvironmentVariableCollectionApi().get, "environment", None, ""),
    (
        app,
        "app",
        app.EnvironmentVariableCollectionApi().post,
        "update_environment",
        app.EnvironmentVariableUpdatePayload(environment_variables=[]),
        "",
    ),
    (
        pipeline,
        "pipeline",
        pipeline.RagPipelineVariableCollectionApi().get,
        "list_variables",
        pipeline.PaginationQuery(),
        "",
    ),
    (pipeline, "pipeline", pipeline.RagPipelineVariableCollectionApi().delete, "delete_all", None, ""),
    (pipeline, "pipeline", pipeline.RagPipelineNodeVariableCollectionApi().get, "node", None, "node"),
    (pipeline, "pipeline", pipeline.RagPipelineNodeVariableCollectionApi().delete, "delete_node", None, "node"),
    (pipeline, "pipeline", pipeline.RagPipelineVariableApi().get, "get", None, "variable"),
    (
        pipeline,
        "pipeline",
        pipeline.RagPipelineVariableApi().patch,
        "patch",
        pipeline.WorkflowDraftVariablePatchPayload(),
        "variable",
    ),
    (pipeline, "pipeline", pipeline.RagPipelineVariableApi().delete, "delete", None, "variable"),
    (pipeline, "pipeline", pipeline.RagPipelineVariableResetApi().put, "reset", None, "variable"),
    (pipeline, "pipeline", pipeline.RagPipelineSystemVariableCollectionApi().get, "system", None, ""),
    (pipeline, "pipeline", pipeline.RagPipelineEnvironmentVariableCollectionApi().get, "environment", None, ""),
    (
        snippet,
        "snippet",
        snippet.SnippetWorkflowVariableCollectionApi().get,
        "list_variables",
        snippet.WorkflowDraftVariableListQuery(),
        "",
    ),
    (snippet, "snippet", snippet.SnippetWorkflowVariableCollectionApi().delete, "delete_all", None, ""),
    (snippet, "snippet", snippet.SnippetNodeVariableCollectionApi().get, "node", None, "node"),
    (snippet, "snippet", snippet.SnippetNodeVariableCollectionApi().delete, "delete_node", None, "node"),
    (snippet, "snippet", snippet.SnippetVariableApi().get, "get", None, "variable"),
    (
        snippet,
        "snippet",
        snippet.SnippetVariableApi().patch,
        "patch",
        snippet.WorkflowDraftVariableUpdatePayload(),
        "variable",
    ),
    (snippet, "snippet", snippet.SnippetVariableApi().delete, "delete", None, "variable"),
    (snippet, "snippet", snippet.SnippetVariableResetApi().put, "reset", None, "variable"),
    (snippet, "snippet", snippet.SnippetConversationVariableCollectionApi().get, "conversation", None, ""),
    (snippet, "snippet", snippet.SnippetSystemVariableCollectionApi().get, "system", None, ""),
    (snippet, "snippet", snippet.SnippetEnvironmentVariableCollectionApi().get, "environment", None, ""),
]


@pytest.mark.parametrize(("module", "kind", "endpoint", "operation", "payload", "suffix"), ENDPOINTS)
def test_endpoint_delegates_and_serializes(
    monkeypatch: pytest.MonkeyPatch,
    module: ModuleType,
    kind: Literal["app", "pipeline", "snippet"],
    endpoint: MethodType,
    operation: str,
    payload: object | None,
    suffix: Literal["", "node", "variable"],
) -> None:
    variables = Variables()
    monkeypatch.setattr(module, "application_services", lambda: Services(variables))
    arguments: list[object] = [] if payload is None else [payload]
    arguments += [CONTEXT, OWNER_ID]
    if suffix:
        arguments.append(VARIABLE_ID if suffix == "variable" else "node")
    response = unwrap(endpoint)(endpoint.__self__, *arguments)
    assert len(variables.calls) == 1
    call = variables.calls[0]
    assert call[:3] == (
        operation,
        CONTEXT,
        str(OWNER_ID) if operation.startswith("update_") else WorkflowOwner(str(OWNER_ID), kind),
    )
    if suffix:
        assert call[3][0] == (str(VARIABLE_ID) if suffix == "variable" else "node")
    if operation.startswith("delete") or operation == "reset":
        assert isinstance(response, Response)
        assert response.status_code == 204
        assert response.data == b""
    elif operation in {"get", "patch"}:
        assert response_mapping(response)["value"] == "answer"
    elif operation == "list_variables":
        items = response_mapping(response)["items"]
        assert isinstance(items, list)
        assert response_mapping(items[0])["id"] == str(VARIABLE_ID)
    if kind == "pipeline":
        assert [check.scene for check in rbac_checks(endpoint)] == [RBACPermission.DATASET_EDIT]
    elif kind == "app":
        assert [check.scene for check in rbac_checks(endpoint)] == [
            RBACPermission.APP_EDIT if operation.startswith("update_") else RBACPermission.APP_VIEW_LAYOUT
        ]


@pytest.mark.parametrize(
    ("failure", "status", "code"),
    [
        (DraftVariableNotFoundError("missing"), 404, "not_found"),
        (DraftWorkflowMissingError(), 404, "draft_workflow_not_exist"),
        (InvalidDraftVariableError("invalid file"), 400, "invalid_param"),
        (DraftVariableChangedError(), 409, "draft_workflow_not_sync"),
        (DraftVariableOwnerNotFoundError("app"), 404, "app_not_found"),
        (DraftVariableOwnerNotFoundError("pipeline"), 404, "pipeline_not_found"),
        (DraftVariableOwnerNotFoundError("snippet"), 404, "not_found"),
    ],
)
def test_domain_errors_use_production_http_mapping(
    monkeypatch: pytest.MonkeyPatch, failure: Exception, status: int, code: str
) -> None:
    def account_admission(
        **_kwargs: object,
    ) -> Callable[[Callable[..., object]], Callable[..., object]]:
        def decorate(view: Callable[..., object]) -> Callable[..., object]:
            def admitted(resource: Resource) -> object:
                return view(resource, CONTEXT)

            return admitted

        return decorate

    monkeypatch.setattr(admission, "console_account_admission", account_admission)
    web = Flask(__name__)
    web.config["RESTX_ERROR_404_HELP"] = False
    api = ExternalApi(web)
    api.error_handlers = console_api.error_handlers.copy()

    class Endpoint(Resource):
        @admission.console_variable_admission("pipeline")
        def get(self, _context: RequestContext) -> None:
            raise failure

    api.add_resource(Endpoint, "/variables")
    response = web.test_client().get("/variables")
    assert response.status_code == status
    assert response_mapping(response.get_json())["code"] == code


@pytest.mark.parametrize("patch", [False, True])
def test_environment_payload_preserves_patch_and_replacement(monkeypatch: pytest.MonkeyPatch, patch: bool) -> None:
    variables = Variables()
    monkeypatch.setattr(app, "application_services", lambda: Services(variables))
    value = {"id": "env-a", "name": "a", "value_type": "string", "value": "new-a"}
    payload = app.EnvironmentVariableUpdatePayload(
        environment_variables=[value], patch=patch, deleted_environment_variable_ids=["env-b"] if patch else []
    )
    endpoint = app.EnvironmentVariableCollectionApi()
    response = unwrap(endpoint.post)(endpoint, payload, CONTEXT, OWNER_ID)
    assert response == {"result": "success"}
    operation, context, owner, args, kwargs = variables.calls[0]
    assert (operation, context, owner) == ("update_environment", CONTEXT, str(OWNER_ID))
    values = args[0]
    assert isinstance(values, Sequence)
    assert response_mapping(values[0])["id"] == "env-a"
    assert response_mapping(values[0])["value"] == "new-a"
    assert kwargs == {"deleted_ids": ["env-b"] if patch else None}
