from __future__ import annotations

from http import HTTPStatus
from uuid import UUID

from flask_restx import Resource
from werkzeug.exceptions import Forbidden

from constants.oauth_bearer import Scope
from controllers.common.rbac import PlainApp, RBACCheck, RBACPermission, Workspace
from controllers.openapi import openapi_ns
from controllers.openapi._contract import Example, Kind, endpoint, op_of
from controllers.openapi._models import (
    AppDslExportQuery,
    AppDslExportResponse,
    AppDslImportPayload,
    AppDslImportResponse,
    Hint,
)
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.requirements import (
    CheckAppApiEnabled,
    CheckRBACPermission,
    CheckScope,
    CheckSubject,
    CheckWorkspaceMember,
    CheckWorkspaceRole,
)
from controllers.openapi.auth.subjects import AccountSubject
from extensions.ext_application_services import application_services
from extensions.ext_database import db
from machinery.context import RequestContext
from models.account import TenantAccountRole
from services.app_dsl_service import AppDslService
from services.entities.dsl_entities import AppImportParams, CheckDependenciesResult, Import, ImportStatus
from services.errors.account import NoPermissionError
from services.errors.app import WorkflowNotFoundError


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
        op="console_app.dsl.import",
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
        requirements=(
            CheckSubject(allowed=(AccountSubject,)),
            CheckScope(Scope.WORKSPACE_WRITE),
            CheckWorkspaceMember(),
            CheckRBACPermission(RBACCheck(RBACPermission.APP_IMPORT_EXPORT_DSL, Workspace())),
            CheckWorkspaceRole(frozenset({TenantAccountRole.EDITOR, TenantAccountRole.ADMIN, TenantAccountRole.OWNER})),
        ),
        body=AppDslImportPayload,
        returns=(
            (HTTPStatus.OK, AppDslImportResponse, "Import completed"),
            (HTTPStatus.ACCEPTED, AppDslImportResponse, "Import pending confirmation"),
            (HTTPStatus.BAD_REQUEST, AppDslImportResponse, "Import failed"),
        ),
    )
    def post(self, ctx: RequestContext, workspace_id: str, *, body: AppDslImportPayload):
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
        op="console_app.dsl.import_confirm",
        kind=Kind.OBJECT,
        summary="Confirm a pending DSL import",
        examples=(Example(title="Confirm an import that is pending confirmation", input={"import_id": "<import_id>"}),),
        requirements=(
            CheckSubject(allowed=(AccountSubject,)),
            CheckScope(Scope.WORKSPACE_WRITE),
            CheckWorkspaceMember(),
            CheckRBACPermission(RBACCheck(RBACPermission.APP_IMPORT_EXPORT_DSL, Workspace())),
            CheckWorkspaceRole(frozenset({TenantAccountRole.EDITOR, TenantAccountRole.ADMIN, TenantAccountRole.OWNER})),
        ),
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
        op="console_app.dsl.export",
        kind=Kind.OBJECT,
        summary="Export app DSL as YAML text inside a JSON object",
        examples=(
            Example(title="Export the current draft as YAML", input={"app_id": "<app_id>"}),
            Example(
                title="Export a published version including secrets",
                input={"app_id": "<app_id>", "workflow_id": "<workflow_id>", "include_secret": True},
            ),
        ),
        requirements=(
            CheckSubject(allowed=(AccountSubject,)),
            CheckAppApiEnabled(),
            CheckWorkspaceMember(),
            CheckScope(Scope.APPS_READ),
            CheckRBACPermission(RBACCheck(RBACPermission.APP_IMPORT_EXPORT_DSL, PlainApp())),
            CheckWorkspaceRole(frozenset({TenantAccountRole.EDITOR, TenantAccountRole.ADMIN, TenantAccountRole.OWNER})),
        ),
        query=AppDslExportQuery,
        returns=(200, AppDslExportResponse, "Export successful"),
    )
    def get(self, ctx: Context, app_id: str, *, query: AppDslExportQuery):
        try:
            data = AppDslService.export_dsl(
                app_model=ctx.app,
                session=db.session(),
                include_secret=query.include_secret,
                workflow_id=query.workflow_id,
            )
        except WorkflowNotFoundError as exc:
            return str(exc), 404
        return AppDslExportResponse(data=data), 200


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
        op="console_app.dependencies.check",
        kind=Kind.OBJECT,
        summary="Check plugin dependencies of an app",
        examples=(Example(title="Check which plugins an app needs", input={"app_id": "<app_id>"}),),
        requirements=(
            CheckSubject(allowed=(AccountSubject,)),
            CheckAppApiEnabled(),
            CheckWorkspaceMember(),
            CheckScope(Scope.APPS_READ),
            CheckRBACPermission(RBACCheck(RBACPermission.APP_IMPORT_EXPORT_DSL, PlainApp())),
            CheckWorkspaceRole(frozenset({TenantAccountRole.EDITOR, TenantAccountRole.ADMIN, TenantAccountRole.OWNER})),
        ),
        returns=(HTTPStatus.OK, CheckDependenciesResult, "Dependencies checked"),
    )
    def get(self, ctx: RequestContext, app_id: str):
        result = application_services().apps.imports.check_dependencies(ctx, str(UUID(app_id)))

        return result, HTTPStatus.OK
