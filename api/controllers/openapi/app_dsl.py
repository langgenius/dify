from __future__ import annotations

from collections.abc import Mapping
from http import HTTPStatus
from typing import Any, Final
from uuid import UUID

import yaml
from flask_restx import Resource
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest, Forbidden, NotFound

from constants.oauth_bearer import Scope
from controllers.common.rbac import RBACCheck, RBACPermission, Workspace
from controllers.openapi import openapi_ns
from controllers.openapi._contract import Example, Kind, endpoint, op_of
from controllers.openapi._errors import DslInvalid, ErrorDetail
from controllers.openapi._models import (
    AppDslExportQuery,
    AppDslExportResponse,
    AppDslImportPayload,
    AppDslImportResponse,
    CheckDependenciesResponse,
    DslCheckPayload,
    DslCheckResponse,
    DslIssueRow,
    Hint,
)
from controllers.openapi.app_workflow import GRAPH_MODES
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.requirements import (
    EDITOR_ROLES,
    CheckRBACPermission,
    CheckScope,
    CheckSubject,
    CheckWorkspaceMember,
    CheckWorkspaceRole,
    account_app_guards,
)
from controllers.openapi.auth.subjects import AccountSubject
from controllers.openapi.plugins import PluginInstallApi
from core.db.session_factory import session_factory
from core.plugin.entities.plugin import PluginDependencyType
from extensions.ext_application_services import application_services
from extensions.ext_database import db
from factories import variable_factory
from graphon.variables import VariableBase
from graphon.variables.exc import VariableError
from machinery.context import RequestContext
from models import AppMode
from services.app.console_service import ConsoleAppNotFoundError
from services.app_dsl_service import AppDslService
from services.entities.dsl_entities import AppImportParams, Import, ImportStatus
from services.errors.app import WorkflowNotFoundError
from services.errors.base import NoPermissionError
from services.workflow.graph_check import GraphIssue, IssueSeverity, ResourceCheck, check_graph
from services.workflow.node_defaults import fill_graph
from services.workflow_service import WorkflowService

_DSL_READ_GUARDS: Final = account_app_guards(RBACPermission.APP_IMPORT_EXPORT_DSL, scope=Scope.APPS_READ, editor=True)
_DSL_WRITE_GUARDS: Final = (
    CheckSubject(allowed=(AccountSubject,)),
    CheckScope(Scope.WORKSPACE_WRITE),
    CheckWorkspaceMember(),
    CheckRBACPermission(RBACCheck(RBACPermission.APP_IMPORT_EXPORT_DSL, Workspace())),
    CheckWorkspaceRole(EDITOR_ROLES),
)


class _DslNotCheckableError(ValueError):
    pass


def _mapping(value: object) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _graph_dsl(context: RequestContext, yaml_content: str, app_id: str | None) -> tuple[Mapping[str, Any], AppMode]:
    """The DSL's workflow section and the mode its graph must fit: the overwritten app's, else the DSL's own."""
    try:
        data = yaml.safe_load(yaml_content)
    except yaml.YAMLError as error:
        raise _DslNotCheckableError(f"Invalid YAML: {error}") from error
    if not isinstance(data, Mapping):
        raise _DslNotCheckableError("The DSL must be a YAML mapping")
    target = (
        application_services().apps.console.get(context, app_id).mode_compatible_with_agent
        if app_id
        else _mapping(data.get("app")).get("mode")
    )
    if target not in GRAPH_MODES:
        raise _DslNotCheckableError("Only workflow or advanced-chat DSLs can be checked")
    return _mapping(data.get("workflow")), AppMode(target)


def _graph_of(workflow: Mapping[str, Any]) -> dict[str, Any]:
    return fill_graph(_mapping(workflow.get("graph")))


def node_credential_check(
    workspace_id: str, environment: Mapping[str, VariableBase], session: Session
) -> ResourceCheck:
    service = WorkflowService()

    def resources(node: Mapping[str, Any]) -> str | None:
        try:
            service.validate_node_credentials(workspace_id, node, environment, session=session)
        except ValueError as error:
            return str(error)
        return None

    return resources


def _dsl_issues(context: RequestContext, yaml_content: str, app_id: str | None) -> list[GraphIssue]:
    try:
        workflow, mode = _graph_dsl(context, yaml_content, app_id)
        environment = {
            variable.name: variable
            for variable in (
                variable_factory.build_environment_variable_from_mapping(item)
                for item in workflow.get("environment_variables") or []
            )
        }
    except (_DslNotCheckableError, VariableError) as error:
        raise BadRequest(str(error)) from error
    except ConsoleAppNotFoundError as error:
        raise NotFound(str(error)) from error
    with session_factory.create_session() as session:
        resources = node_credential_check(context.active_workspace_id, environment, session)
        return check_graph(_graph_of(workflow), mode=mode, resources=resources)


def _refuse_invalid_dsl(context: RequestContext, body: AppDslImportPayload) -> None:
    """Refuse a YAML import whose graph has error-severity issues; DSLs the check can't read are left to the import."""
    if body.mode != "yaml-content" or not body.yaml_content:
        return
    try:
        workflow, mode = _graph_dsl(context, body.yaml_content, body.app_id)
    except (_DslNotCheckableError, ConsoleAppNotFoundError):
        return
    errors = [i for i in check_graph(_graph_of(workflow), mode=mode) if i.code.severity is IssueSeverity.ERROR]
    if errors:
        raise DslInvalid(
            details=[ErrorDetail(type=i.code, loc=list(i.loc), msg=i.message) for i in errors],
            hints=[
                Hint(
                    summary="See every problem, including warnings",
                    op=op_of(AppDslCheckApi.post),
                    input={
                        "workspace_id": context.active_workspace_id,
                        "yaml_content": None,
                        "app_id": body.app_id,
                    },
                )
            ],
        )


def issue_row(issue: GraphIssue) -> DslIssueRow:
    return DslIssueRow(
        code=issue.code,
        severity=issue.code.severity,
        node_id=issue.node_id,
        loc=list(issue.loc),
        message=issue.message,
    )


def _import_response(result: Import, *, workspace_id: str) -> AppDslImportResponse:
    hints: list[Hint] = []
    if result.status == ImportStatus.PENDING:
        hints.append(
            Hint(
                summary="Confirm the pending import",
                op=op_of(AppDslImportConfirmApi.post),
                input={"workspace_id": workspace_id, "import_id": result.id},
            )
        )
    return AppDslImportResponse(**result.model_dump(), hints=hints)


@openapi_ns.route("/workspaces/<string:workspace_id>/apps/imports")
class AppDslImportApi(Resource):
    """Import a DSL YAML string into the specified workspace.

    Use ``mode=yaml-content`` with ``yaml_content`` for inline YAML, or
    ``mode=yaml-url`` with ``yaml_url`` for a remote URL.  Provide ``app_id``
    to overwrite an existing workflow or advanced-chat app; omit it to create
    a new app.

    Returns 202 when the DSL version requires an explicit confirmation step
    (major version mismatch).  Callers must then POST to the imports :confirm method.
    Returns 400 when the import failed due to invalid DSL or a business error.
    """

    @endpoint(
        account_context=True,
        op="import.console_app.dsl",
        kind=Kind.OBJECT,
        summary="Import an app from DSL text or URL",
        examples=(
            Example(
                title="Import an app from inline YAML",
                input={"mode": "yaml-content", "yaml_content": "<yaml text of the app DSL>"},
            ),
            Example(
                title="Import an app from a URL",
                input={"mode": "yaml-url", "yaml_url": "https://example.com/apps/release-summary.yml"},
            ),
            Example(
                title="Overwrite an existing workflow app from YAML",
                input={"mode": "yaml-content", "yaml_content": "<yaml text of the app DSL>", "app_id": "<app_id>"},
            ),
        ),
        requirements=_DSL_WRITE_GUARDS,
        body=AppDslImportPayload,
        returns=(
            (HTTPStatus.OK, AppDslImportResponse, "Import completed"),
            (HTTPStatus.ACCEPTED, AppDslImportResponse, "Import pending confirmation"),
            (HTTPStatus.BAD_REQUEST, AppDslImportResponse, "Import failed"),
        ),
    )
    def post(self, ctx: RequestContext, workspace_id: str, *, body: AppDslImportPayload):
        _refuse_invalid_dsl(ctx, body)
        try:
            result = application_services().apps.imports.import_app(
                ctx, AppImportParams.model_validate(body.model_dump())
            )
        except NoPermissionError as exc:
            raise Forbidden(str(exc)) from exc

        response = _import_response(result, workspace_id=workspace_id)
        match result.status:
            case ImportStatus.FAILED:
                return response, HTTPStatus.BAD_REQUEST
            case ImportStatus.PENDING:
                return response, HTTPStatus.ACCEPTED
            case _:
                return response, HTTPStatus.OK


@openapi_ns.route("/workspaces/<string:workspace_id>/apps/imports:check")
class AppDslCheckApi(Resource):
    """Check a DSL without importing it.

    Errors are what the import refuses; warnings (missing credentials or models) are what publish refuses.
    Pass ``app_id`` to check against an existing app's mode, as an overwrite import would.
    """

    @endpoint(
        account_context=True,
        op="check.console_app.dsl",
        kind=Kind.OBJECT,
        summary="Check a DSL without importing it: every problem with its node and field",
        examples=(Example(title="Check a DSL (pipe the YAML)", input={"yaml_content": "<yaml text of the app DSL>"}),),
        requirements=_DSL_WRITE_GUARDS,
        body=DslCheckPayload,
        returns=(HTTPStatus.OK, DslCheckResponse, "Check result"),
    )
    def post(self, ctx: RequestContext, workspace_id: str, *, body: DslCheckPayload):
        issues = _dsl_issues(ctx, body.yaml_content, body.app_id)
        response = DslCheckResponse(
            valid=not any(i.code.severity is IssueSeverity.ERROR for i in issues),
            issues=[issue_row(i) for i in issues],
        )
        return response, HTTPStatus.OK


@openapi_ns.route("/workspaces/<string:workspace_id>/apps/imports/<string:import_id>:confirm")
class AppDslImportConfirmApi(Resource):
    """Confirm a pending DSL import identified by ``import_id``.

    Required only when the initial import returned 202 (major DSL version
    mismatch that requires explicit acknowledgement).  The pending state is
    stored in Redis for 10 minutes; this call retrieves it and completes the
    import under the given workspace.

    Returns 400 when the pending data has expired or the import fails.
    """

    @endpoint(
        account_context=True,
        op="confirm.console_app.dsl_import",
        kind=Kind.OBJECT,
        summary="Confirm a pending DSL import",
        examples=(Example(title="Confirm an import that is pending confirmation", input={"import_id": "<import_id>"}),),
        requirements=_DSL_WRITE_GUARDS,
        returns=((HTTPStatus.OK, Import, "Import confirmed"), (HTTPStatus.BAD_REQUEST, Import, "Import failed")),
    )
    def post(self, ctx: RequestContext, workspace_id: str, import_id: str):
        try:
            result = application_services().apps.imports.confirm_import(ctx, import_id)
        except NoPermissionError as exc:
            raise Forbidden(str(exc)) from exc

        if result.status == ImportStatus.FAILED:
            return result, HTTPStatus.BAD_REQUEST
        return result, HTTPStatus.OK


@openapi_ns.route("/apps/<string:app_id>/dsl")
class AppDslExportApi(Resource):
    """Export an app's current draft configuration as a DSL YAML string.

    The auth pipeline resolves the app and its tenant from ``app_id``.  Pass
    ``include_secret=true`` to embed encrypted credential values (e.g. tool
    node secrets); omit it to produce a portable, sharable DSL safe to share.

    Note: the pipeline enforces ``app.enable_api`` for all ``/apps/<app_id>``
    routes in the openapi group.  Apps with the service API disabled will
    receive a 403; enable the API in the console first if needed.
    """

    @endpoint(
        op="export.console_app.dsl",
        kind=Kind.OBJECT,
        summary="Export app DSL as YAML text inside a JSON object",
        examples=(
            Example(title="Export the current draft as YAML", input={"app_id": "<app_id>"}),
            Example(
                title="Export a published version including secrets",
                input={"app_id": "<app_id>", "workflow_id": "<workflow_id>", "include_secret": True},
            ),
        ),
        requirements=_DSL_READ_GUARDS,
        query=AppDslExportQuery,
        returns=(200, AppDslExportResponse, "Export successful"),
    )
    def get(self, ctx: Context, app_id: str, *, query: AppDslExportQuery):
        draft = WorkflowService().get_draft_workflow(app_model=ctx.app, session=db.session())
        try:
            data = AppDslService.export_dsl(
                app_model=ctx.app,
                session=db.session(),
                include_secret=query.include_secret,
                workflow_id=query.workflow_id,
            )
        except WorkflowNotFoundError as exc:
            return str(exc), 404
        return AppDslExportResponse(data=data, draft_hash=draft.content_hash if draft else None), 200


@openapi_ns.route("/apps/<string:app_id>/dependencies:check")
class AppDslCheckDependenciesApi(Resource):
    """Check for leaked plugin dependencies after a DSL import.

    Call this after an import that reported ``COMPLETED_WITH_WARNINGS`` to
    find which plugin dependencies referenced in the DSL are not yet installed
    in the workspace.  Returns an empty ``leaked_dependencies`` list when all
    dependencies are satisfied.
    """

    @endpoint(
        account_context=True,
        op="check.console_app.dependency",
        kind=Kind.OBJECT,
        summary="Check plugin dependencies of an app",
        examples=(Example(title="Check which plugins an app needs", input={"app_id": "<app_id>"}),),
        requirements=_DSL_READ_GUARDS,
        returns=(HTTPStatus.OK, CheckDependenciesResponse, "Dependencies checked"),
    )
    def get(self, ctx: RequestContext, app_id: str):
        result = application_services().apps.imports.check_dependencies(ctx, str(UUID(app_id)))
        missing = [
            dependency.value.plugin_unique_identifier
            for dependency in result.leaked_dependencies
            if dependency.type == PluginDependencyType.Marketplace
        ]
        hints = (
            [
                Hint(
                    summary="Install the missing marketplace plugins",
                    op=op_of(PluginInstallApi.post),
                    input={"workspace_id": ctx.active_workspace_id, "identifiers": missing},
                )
            ]
            if missing
            else []
        )
        return CheckDependenciesResponse(**result.model_dump(), hints=hints), HTTPStatus.OK
