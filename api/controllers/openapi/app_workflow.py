"""Build routes on /openapi/v1 for workflow and advanced-chat apps: run history,
publishing and versions, and draft environment variables."""

from __future__ import annotations

from collections.abc import Iterable
from http import HTTPStatus
from typing import Any, Final
from uuid import UUID

from flask_restx import Resource
from werkzeug.exceptions import BadRequest

from constants import HIDDEN_VALUE
from constants.oauth_bearer import Scope
from controllers.common.fields import SimpleResultResponse
from controllers.common.rbac import RBACPermission
from controllers.openapi import openapi_ns
from controllers.openapi._contract import Example, Kind, endpoint
from controllers.openapi._errors import (
    DraftNotFound,
    EnvVariableNotFound,
    NodeNotFound,
    OpenApiError,
    RunNotFound,
    SecretMaskNotSecret,
    SecretMaskUnknownId,
    VersionNotFound,
    VersionNotRestorable,
)
from controllers.openapi._models import (
    AdvancedChatNodeRunPayload,
    EnvVariableListResponse,
    EnvVariableRow,
    EnvVariableSetPayload,
    EnvVariableValueType,
    Hint,
    NodeRunPayload,
    PublishPayload,
    PublishResponse,
    RestoreResponse,
    RunListQuery,
    RunListResponse,
    VersionListQuery,
    VersionListResponse,
    VersionRow,
)
from controllers.openapi.app_run import _DRAFT_RUN_GUARDS, require_mode
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.requirements import CheckAppMode, account_app_guards
from core.helper import encrypter
from core.workflow.llm_environment_variable import environment_variable_value_type
from extensions.ext_application_services import application_services
from extensions.ext_database import db
from factories import variable_factory
from fields.workflow_run_fields import (
    WorkflowRunDetailResponse,
    WorkflowRunNodeExecutionListResponse,
    WorkflowRunNodeExecutionResponse,
    node_execution_response_source,
    workflow_run_pagination_response_source,
    workflow_run_response_source,
)
from graphon.enums import BuiltinNodeTypes
from graphon.variables import SecretVariable, VariableBase
from graphon.variables.exc import VariableError
from libs.helper import to_timestamp
from models import AppMode, WorkflowRunTriggeredFrom
from models.workflow import Workflow, WorkflowRun
from services.errors.app import IsDraftWorkflowError, WorkflowNotFoundError
from services.workflow_run_service import WorkflowRunListArgs
from services.workflow_service import WorkflowService
from services.workflow_variable_reference_validator import advisory_variable_reference_warning

GRAPH_MODES: Final = (AppMode.WORKFLOW, AppMode.ADVANCED_CHAT)
_RUN_LIST_OP: Final = "get.run"
_VERSION_LIST_OP: Final = "get.console_app.version"

_RUN_READ_GUARDS: Final = account_app_guards(
    RBACPermission.APP_CREATE_AND_MANAGEMENT, scope=Scope.APPS_READ, editor=False
)
_VERSION_READ_GUARDS: Final = account_app_guards(RBACPermission.APP_VIEW_LAYOUT, scope=Scope.APPS_READ, editor=True)
_RELEASE_GUARDS: Final = account_app_guards(
    RBACPermission.APP_RELEASE_AND_VERSION, scope=Scope.WORKSPACE_WRITE, editor=True
)
_ENV_READ_GUARDS: Final = account_app_guards(RBACPermission.APP_VIEW_LAYOUT, scope=Scope.APPS_READ, editor=True)
_ENV_WRITE_GUARDS: Final = account_app_guards(RBACPermission.APP_EDIT, scope=Scope.WORKSPACE_WRITE, editor=True)


def _require_uuid(value: str, *, not_found: type[OpenApiError]) -> str:
    """Parse a path id as a UUID or raise 404; an unparsed id would otherwise reach
    a UUID-typed database column and fail as a 500."""
    try:
        return str(UUID(value))
    except ValueError:
        raise not_found()


def _require_run(ctx: Context, run_id: str) -> WorkflowRun:
    run = application_services().workflow_runs.get_workflow_run(
        ctx.request_context, app_id=ctx.app.id, run_id=_require_uuid(run_id, not_found=RunNotFound)
    )
    if run is None:
        raise RunNotFound()
    return run


def with_next_cursor(page: RunListResponse, *, op: str, app_id: str, query: RunListQuery) -> RunListResponse:
    if page.has_more and page.data:
        next_input = {"app_id": app_id, **query.model_dump(exclude_none=True), "last_id": page.data[-1].id}
        page.hints = [Hint(summary="Next page", op=op, input=next_input)]
    return page


@openapi_ns.route("/apps/<string:app_id>/runs")
class AppRunListApi(Resource):
    @endpoint(
        op=_RUN_LIST_OP,
        kind=Kind.OBJECT,
        summary="List runs of a workflow or advanced-chat app, newest first",
        examples=(
            Example(
                title="Latest failed runs from real use",
                input={"app_id": "<app_id>", "status": "failed", "triggered_from": "app-run"},
            ),
            Example(
                title="My latest draft test run",
                input={"app_id": "<app_id>", "triggered_from": "debugging", "limit": 1},
            ),
        ),
        requirements=_RUN_READ_GUARDS,
        query=RunListQuery,
        returns=(HTTPStatus.OK, RunListResponse, "Run list"),
    )
    def get(self, ctx: Context, app_id: str, *, query: RunListQuery):
        require_mode(ctx.app, *GRAPH_MODES)
        args: WorkflowRunListArgs = {"limit": query.limit}
        if query.last_id is not None:
            args["last_id"] = query.last_id
        if query.status is not None:
            args["status"] = query.status
        pagination = application_services().workflow_runs.get_paginate_workflow_runs(
            ctx.request_context,
            app_id=ctx.app.id,
            args=args,
            triggered_from=WorkflowRunTriggeredFrom(query.triggered_from or WorkflowRunTriggeredFrom.DEBUGGING),
        )
        page = RunListResponse.model_validate(workflow_run_pagination_response_source(pagination, session=ctx.session))
        return with_next_cursor(page, op=_RUN_LIST_OP, app_id=ctx.app.id, query=query)


@openapi_ns.route("/apps/<string:app_id>/runs/<string:run_id>")
class AppRunDescribeApi(Resource):
    @endpoint(
        op="describe.run",
        kind=Kind.OBJECT,
        summary="One run: inputs, outputs, error, tokens and timing",
        examples=(Example(title="Read one run", input={"app_id": "<app_id>", "run_id": "<run_id>"}),),
        requirements=_RUN_READ_GUARDS,
        returns=(HTTPStatus.OK, WorkflowRunDetailResponse, "Run detail"),
    )
    def get(self, ctx: Context, app_id: str, run_id: str):
        require_mode(ctx.app, *GRAPH_MODES)
        run = _require_run(ctx, run_id)
        return WorkflowRunDetailResponse.model_validate(workflow_run_response_source(run, session=ctx.session))


@openapi_ns.route("/apps/<string:app_id>/runs/<string:run_id>/nodes")
class AppRunNodeListApi(Resource):
    @endpoint(
        op="get.run.node",
        kind=Kind.OBJECT,
        summary="Each node step of a run, to find the one that failed",
        examples=(Example(title="Node steps of one run", input={"app_id": "<app_id>", "run_id": "<run_id>"}),),
        requirements=_RUN_READ_GUARDS,
        returns=(HTTPStatus.OK, WorkflowRunNodeExecutionListResponse, "Node steps"),
    )
    def get(self, ctx: Context, app_id: str, run_id: str):
        require_mode(ctx.app, *GRAPH_MODES)
        run = _require_run(ctx, run_id)
        steps = application_services().workflow_runs.get_workflow_run_node_executions(
            ctx.request_context, app_id=ctx.app.id, run_id=run.id
        )
        return WorkflowRunNodeExecutionListResponse.model_validate({"data": steps})


@openapi_ns.route("/apps/<string:app_id>:publish")
class AppPublishApi(Resource):
    @endpoint(
        op="publish.console_app",
        kind=Kind.OBJECT,
        summary="Publish the draft as a new version and make the app use it",
        examples=(
            Example(title="Publish the draft", input={"app_id": "<app_id>"}),
            Example(
                title="Publish a named version",
                input={"app_id": "<app_id>", "marked_name": "v2", "marked_comment": "Adds a retry"},
            ),
        ),
        requirements=_RELEASE_GUARDS,
        body=PublishPayload,
        returns=(HTTPStatus.OK, PublishResponse, "Published"),
    )
    def post(self, ctx: Context, app_id: str, *, body: PublishPayload):
        require_mode(ctx.app, *GRAPH_MODES)
        try:
            workflow = WorkflowService().publish_app_workflow(
                session=ctx.session,
                app_model=ctx.app,
                account=ctx.account,
                marked_name=body.marked_name,
                marked_comment=body.marked_comment,
            )
        except ValueError as exc:
            raise BadRequest(str(exc)) from exc
        return PublishResponse(
            version_id=workflow.id,
            created_at=to_timestamp(workflow.created_at),
            warning=advisory_variable_reference_warning(workflow.graph),
        )


@openapi_ns.route("/apps/<string:app_id>/versions")
class AppVersionListApi(Resource):
    @endpoint(
        op=_VERSION_LIST_OP,
        kind=Kind.OBJECT,
        summary="List published versions, newest first",
        examples=(
            Example(title="Latest versions", input={"app_id": "<app_id>"}),
            Example(title="Only named versions", input={"app_id": "<app_id>", "named_only": True}),
        ),
        requirements=_VERSION_READ_GUARDS,
        query=VersionListQuery,
        returns=(HTTPStatus.OK, VersionListResponse, "Version list"),
    )
    def get(self, ctx: Context, app_id: str, *, query: VersionListQuery):
        require_mode(ctx.app, *GRAPH_MODES)
        workflows, has_more = WorkflowService().get_all_published_workflow(
            session=ctx.session,
            app_model=ctx.app,
            page=query.page,
            limit=query.limit,
            user_id=None,
            named_only=query.named_only,
            include_draft=False,
        )
        page = VersionListResponse(
            page=query.page,
            limit=query.limit,
            has_more=has_more,
            data=[
                VersionRow.model_validate(workflow).model_copy(update={"current": workflow.id == ctx.app.workflow_id})
                for workflow in workflows
            ],
        )
        if has_more:
            next_input = {"app_id": ctx.app.id, **query.model_dump(), "page": query.page + 1}
            page.hints = [Hint(summary="Next page", op=_VERSION_LIST_OP, input=next_input)]
        return page


@openapi_ns.route("/apps/<string:app_id>/versions/<string:version_id>:restore")
class AppVersionRestoreApi(Resource):
    @endpoint(
        op="restore.console_app.version",
        kind=Kind.OBJECT,
        summary="Copy a published version into the draft; publish again to make it live",
        examples=(
            Example(title="Restore an older version", input={"app_id": "<app_id>", "version_id": "<version_id>"}),
        ),
        requirements=_RELEASE_GUARDS,
        returns=(HTTPStatus.OK, RestoreResponse, "Restored into the draft"),
    )
    def post(self, ctx: Context, app_id: str, version_id: str):
        require_mode(ctx.app, *GRAPH_MODES)
        version_id = _require_uuid(version_id, not_found=VersionNotFound)
        try:
            draft = WorkflowService().restore_published_workflow_to_draft(
                app_model=ctx.app, workflow_id=version_id, account=ctx.account, session=db.session()
            )
        except IsDraftWorkflowError as exc:
            raise VersionNotRestorable() from exc
        except WorkflowNotFoundError as exc:
            raise VersionNotFound() from exc
        except ValueError as exc:
            raise BadRequest(str(exc)) from exc
        return RestoreResponse(result="success", draft_hash=draft.content_hash)


def env_variable_rows(variables: Iterable[VariableBase]) -> list[EnvVariableRow]:
    return [
        EnvVariableRow(
            id=variable.id,
            name=variable.name,
            description=variable.description,
            value_type=environment_variable_value_type(variable),
            value=encrypter.full_mask_token()
            if isinstance(variable, SecretVariable) and variable.value
            else variable.value,
        )
        for variable in variables
    ]


def _require_draft(ctx: Context) -> Workflow:
    draft = WorkflowService().get_draft_workflow(app_model=ctx.app, session=ctx.session)
    if draft is None:
        raise DraftNotFound()
    return draft


def _stored_secret_ids(draft: Workflow) -> set[str]:
    return {variable.id for variable in draft.environment_variables if isinstance(variable, SecretVariable)}


def _patch_env(ctx: Context, *, upserts: list[VariableBase], deletions: list[str]) -> None:
    try:
        WorkflowService().patch_draft_workflow_environment_variables(
            app_model=ctx.app,
            environment_variables=upserts,
            deleted_environment_variable_ids=deletions,
            account=ctx.account,
            session=db.session(),
        )
    except ValueError as exc:
        raise BadRequest(str(exc)) from exc


@openapi_ns.route("/apps/<string:app_id>/env")
class AppEnvListApi(Resource):
    @endpoint(
        op="get.console_app.env",
        kind=Kind.OBJECT,
        summary="Environment variables of the draft. Each has an id, which set and delete take, "
        "and a name, which nodes use. Secrets with a value are masked; empty secrets read as empty",
        examples=(Example(title="List environment variables", input={"app_id": "<app_id>"}),),
        requirements=_ENV_READ_GUARDS,
        returns=(HTTPStatus.OK, EnvVariableListResponse, "Environment variables"),
    )
    def get(self, ctx: Context, app_id: str):
        require_mode(ctx.app, *GRAPH_MODES)
        return EnvVariableListResponse(data=env_variable_rows(_require_draft(ctx).environment_variables))


@openapi_ns.route("/apps/<string:app_id>/env/<string:env_id>")
class AppEnvItemApi(Resource):
    @endpoint(
        op="set.console_app.env",
        kind=Kind.OBJECT,
        summary="Add or replace one environment variable of the draft, keyed by its id from get console_app env, "
        "not its name. A new id (e.g. a fresh UUID) adds a variable. Others are left alone",
        examples=(
            Example(
                title="Set an API key as a secret",
                input={
                    "app_id": "<app_id>",
                    "env_id": "<env_id>",
                    "name": "API_KEY",
                    "value_type": "secret",
                    "value": "sk-...",
                },
            ),
        ),
        requirements=_ENV_WRITE_GUARDS,
        body=EnvVariableSetPayload,
        returns=(HTTPStatus.OK, SimpleResultResponse, "Variable set"),
    )
    def put(self, ctx: Context, app_id: str, env_id: str, *, body: EnvVariableSetPayload):
        require_mode(ctx.app, *GRAPH_MODES)
        draft = _require_draft(ctx)
        if body.value == encrypter.full_mask_token() and body.value_type != EnvVariableValueType.SECRET:
            raise SecretMaskNotSecret()
        [mapping] = Workflow.normalize_environment_variable_mappings([{**body.model_dump(mode="json"), "id": env_id}])
        if mapping["value"] == HIDDEN_VALUE and env_id not in _stored_secret_ids(draft):
            raise SecretMaskUnknownId()
        try:
            variable = variable_factory.build_environment_variable_from_mapping(mapping)
        except VariableError as exc:
            raise BadRequest(str(exc)) from exc
        _patch_env(ctx, upserts=[variable], deletions=[])
        return SimpleResultResponse(result="success")

    @endpoint(
        op="delete.console_app.env",
        kind=Kind.OBJECT,
        summary="Remove one environment variable from the draft, keyed by its id from get console_app env, "
        "not its name. Others are left alone",
        examples=(Example(title="Remove a variable", input={"app_id": "<app_id>", "env_id": "<env_id>"}),),
        requirements=_ENV_WRITE_GUARDS,
        returns=(HTTPStatus.OK, SimpleResultResponse, "Variable removed"),
    )
    def delete(self, ctx: Context, app_id: str, env_id: str):
        require_mode(ctx.app, *GRAPH_MODES)
        if all(variable.id != env_id for variable in _require_draft(ctx).environment_variables):
            raise EnvVariableNotFound()
        _patch_env(ctx, upserts=[], deletions=[env_id])
        return SimpleResultResponse(result="success")


_CONTAINER_NODE_TYPES: Final = frozenset({BuiltinNodeTypes.LOOP, BuiltinNodeTypes.ITERATION})


def run_draft_node(
    ctx: Context, node_id: str, *, inputs: dict[str, Any], query: str
) -> WorkflowRunNodeExecutionResponse:
    workflow_service = WorkflowService()
    draft = _require_draft(ctx)
    node = next((node for node in draft.graph_dict.get("nodes", []) if node.get("id") == node_id), None)
    if node is None:
        raise NodeNotFound()
    if node.get("data", {}).get("type") in _CONTAINER_NODE_TYPES:
        raise BadRequest("Loop and iteration nodes can't run alone; test them with a full draft run")
    try:
        execution = workflow_service.run_draft_workflow_node(
            app_model=ctx.app,
            draft_workflow=draft,
            node_id=node_id,
            user_inputs=inputs,
            account=ctx.account,
            query=query,
        )
    except ValueError as exc:
        raise BadRequest(str(exc)) from exc
    return WorkflowRunNodeExecutionResponse.model_validate(
        node_execution_response_source(execution, session=ctx.session), from_attributes=True
    )


@openapi_ns.route("/apps/<string:app_id>/draft/workflow/nodes/<string:node_id>:run")
class WorkflowDraftNodeRunApi(Resource):
    @endpoint(
        op="test.node.workflow",
        kind=Kind.OBJECT,
        summary="Test one node of a workflow draft, reusing what the last draft run saved",
        examples=(
            Example(title="Test a node", input={"app_id": "<app_id>", "node_id": "<node_id>"}),
            Example(
                title="Test a node with an upstream value overridden",
                input={"app_id": "<app_id>", "node_id": "<node_id>", "inputs": {"#llm.text#": "Hello"}},
            ),
        ),
        requirements=(*_DRAFT_RUN_GUARDS, CheckAppMode(AppMode.WORKFLOW)),
        body=NodeRunPayload,
        returns=(HTTPStatus.OK, WorkflowRunNodeExecutionResponse, "Node execution"),
    )
    def post(self, ctx: Context, app_id: str, node_id: str, *, body: NodeRunPayload):
        return run_draft_node(ctx, node_id, inputs=body.inputs, query="")


@openapi_ns.route("/apps/<string:app_id>/draft/advanced-chat/nodes/<string:node_id>:run")
class AdvancedChatDraftNodeRunApi(Resource):
    @endpoint(
        op="test.node.advanced_chat",
        kind=Kind.OBJECT,
        summary="Test one node of an advanced-chat draft, reusing what the last draft run saved",
        examples=(Example(title="Test a node", input={"app_id": "<app_id>", "node_id": "<node_id>", "query": "Hi"}),),
        requirements=(*_DRAFT_RUN_GUARDS, CheckAppMode(AppMode.ADVANCED_CHAT)),
        body=AdvancedChatNodeRunPayload,
        returns=(HTTPStatus.OK, WorkflowRunNodeExecutionResponse, "Node execution"),
    )
    def post(self, ctx: Context, app_id: str, node_id: str, *, body: AdvancedChatNodeRunPayload):
        return run_draft_node(ctx, node_id, inputs=body.inputs, query=body.query)
