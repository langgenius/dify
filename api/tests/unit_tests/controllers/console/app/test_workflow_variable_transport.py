"""Transport delegates all three scopes without ORM objects or Sessions."""

from dataclasses import dataclass, field
from inspect import unwrap
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


@dataclass
class Variables:
    calls: list = field(default_factory=list)

    def record(self, op, context, owner, *args, **kwargs):
        self.calls.append((op, context, owner, args, kwargs))

    def list_variables(self, *args, **kwargs):
        self.record("list_variables", *args, **kwargs)
        return ConsoleVariableList([VARIABLE], 1)

    def node(self, *args):
        self.record("node", *args)
        return ConsoleVariableList([VARIABLE])

    def system(self, *args):
        self.record("system", *args)
        return ConsoleVariableList([])

    def conversation(self, *args):
        self.record("conversation", *args)
        return ConsoleVariableList([])

    def environment(self, *args):
        self.record("environment", *args)
        return []

    def get(self, *args):
        self.record("get", *args)
        return VARIABLE

    def patch(self, *args, **kwargs):
        self.record("patch", *args, **kwargs)
        return VARIABLE

    def reset(self, *args):
        self.record("reset", *args)

    def delete(self, *args):
        self.record("delete", *args)

    def delete_all(self, *args):
        self.record("delete_all", *args)

    def delete_node(self, *args):
        self.record("delete_node", *args)

    def update_conversation(self, *args):
        self.record("update_conversation", *args)

    def update_environment(self, *args, **kwargs):
        self.record("update_environment", *args, **kwargs)


@dataclass
class Services:
    console_workflow_variables: Variables


ENDPOINTS = [
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
def test_endpoint_delegates_and_serializes(monkeypatch, module, kind, endpoint, operation, payload, suffix):
    variables = Variables()
    monkeypatch.setattr(module, "application_services", lambda: Services(variables))
    args = [] if payload is None else [payload]
    args += [CONTEXT, OWNER_ID]
    if suffix:
        args += [VARIABLE_ID if suffix == "variable" else "node"]
    response = unwrap(endpoint)(endpoint.__self__, *args)
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
        assert response["value"] == "answer"
    elif operation == "list_variables":
        assert response["items"][0]["id"] == str(VARIABLE_ID)
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
def test_domain_errors_use_production_http_mapping(monkeypatch, failure, status, code):
    def account_admission(**_kwargs):
        def decorate(view):
            def admitted(self):
                return view(self, CONTEXT)

            return admitted

        return decorate

    monkeypatch.setattr(admission, "console_account_admission", account_admission)
    web = Flask(__name__)
    web.config["RESTX_ERROR_404_HELP"] = False
    api = ExternalApi(web)
    api.error_handlers = console_api.error_handlers.copy()

    class Endpoint(Resource):
        @admission.console_variable_admission("pipeline")
        def get(self, _context):
            raise failure

    api.add_resource(Endpoint, "/variables")
    response = web.test_client().get("/variables")
    assert response.status_code == status
    assert response.json["code"] == code


@pytest.mark.parametrize("patch", [False, True])
def test_environment_payload_preserves_patch_and_replacement(monkeypatch, patch):
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
    assert args[0][0]["id"] == "env-a"
    assert args[0][0]["value"] == "new-a"
    assert kwargs == {"deleted_ids": ["env-b"] if patch else None}
