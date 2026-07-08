from __future__ import annotations

from typing import cast

from flask_restx import Resource
from sqlalchemy.orm import Session

from controllers.common.wraps import RBACPermission, RBACResourceScope
from controllers.openapi import openapi_ns
from controllers.openapi._contract import accepts, returns
from controllers.openapi._models import AppDslExportQuery, AppDslExportResponse, AppDslImportPayload
from controllers.openapi.auth.composition import auth_router
from controllers.openapi.auth.data import AuthData, RBACRequirement
from extensions.ext_database import db
from libs.oauth_bearer import Scope, TokenType
from models import Account, App
from models.account import TenantAccountRole
from services.app_dsl_service import AppDslService, Import
from services.entities.dsl_entities import CheckDependenciesResult, ImportStatus
from services.errors.app import WorkflowNotFoundError


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

    @auth_router.guard_workspace(
        scope=Scope.WORKSPACE_WRITE,
        allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}),
        allowed_roles=frozenset({TenantAccountRole.EDITOR, TenantAccountRole.ADMIN, TenantAccountRole.OWNER}),
        rbac=RBACRequirement(
            resource_type=RBACResourceScope.APP,
            scene=RBACPermission.APP_IMPORT_EXPORT_DSL,
            resource_required=False,
        ),
    )
    @returns(200, Import, "Import completed")
    @returns(202, Import, "Import pending confirmation")
    @returns(400, Import, "Import failed")
    @accepts(body=AppDslImportPayload)
    def post(self, workspace_id: str, *, auth_data: AuthData, body: AppDslImportPayload):
        account = cast(Account, auth_data.caller)

        with Session(db.engine, expire_on_commit=False) as session:
            service = AppDslService(session)
            result = service.import_app(
                account=account,
                import_mode=body.mode,
                yaml_content=body.yaml_content,
                yaml_url=body.yaml_url,
                name=body.name,
                description=body.description,
                icon_type=body.icon_type,
                icon=body.icon,
                icon_background=body.icon_background,
                app_id=body.app_id,
            )
            if result.status == ImportStatus.FAILED:
                session.rollback()
            else:
                session.commit()

        match result.status:
            case ImportStatus.FAILED:
                return result, 400
            case ImportStatus.PENDING:
                return result, 202
            case _:
                return result, 200


@openapi_ns.route("/workspaces/<string:workspace_id>/apps/imports/<string:import_id>:confirm")
class AppDslImportConfirmApi(Resource):
    """Confirm a pending DSL import identified by ``import_id``.

    Required only when the initial import returned 202 (major DSL version
    mismatch that requires explicit acknowledgement).  The pending state is
    stored in Redis for 10 minutes; this call retrieves it and completes the
    import under the given workspace.

    Returns 400 when the pending data has expired or the import fails.
    """

    @auth_router.guard_workspace(
        scope=Scope.WORKSPACE_WRITE,
        allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}),
        allowed_roles=frozenset({TenantAccountRole.EDITOR, TenantAccountRole.ADMIN, TenantAccountRole.OWNER}),
        rbac=RBACRequirement(
            resource_type=RBACResourceScope.APP,
            scene=RBACPermission.APP_IMPORT_EXPORT_DSL,
            resource_required=False,
        ),
    )
    @returns(200, Import, "Import confirmed")
    @returns(400, Import, "Import failed")
    def post(self, workspace_id: str, import_id: str, *, auth_data: AuthData):
        account = cast(Account, auth_data.caller)

        with Session(db.engine, expire_on_commit=False) as session:
            service = AppDslService(session)
            result = service.confirm_import(import_id=import_id, account=account)
            if result.status == ImportStatus.FAILED:
                session.rollback()
            else:
                session.commit()

        if result.status == ImportStatus.FAILED:
            return result, 400
        return result, 200


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

    @auth_router.guard(
        scope=Scope.APPS_READ,
        allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}),
        allowed_roles=frozenset({TenantAccountRole.EDITOR, TenantAccountRole.ADMIN, TenantAccountRole.OWNER}),
        rbac=RBACRequirement(resource_type=RBACResourceScope.APP, scene=RBACPermission.APP_IMPORT_EXPORT_DSL),
    )
    @accepts(query=AppDslExportQuery)
    @returns(200, AppDslExportResponse, "Export successful")
    def get(self, app_id: str, *, auth_data: AuthData, query: AppDslExportQuery):
        app = cast(App, auth_data.app)
        try:
            data = AppDslService.export_dsl(
                app_model=app,
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

    @auth_router.guard(
        scope=Scope.APPS_READ,
        allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}),
        allowed_roles=frozenset({TenantAccountRole.EDITOR, TenantAccountRole.ADMIN, TenantAccountRole.OWNER}),
        rbac=RBACRequirement(resource_type=RBACResourceScope.APP, scene=RBACPermission.APP_IMPORT_EXPORT_DSL),
    )
    @returns(200, CheckDependenciesResult, "Dependencies checked")
    def get(self, app_id: str, *, auth_data: AuthData):
        app = cast(App, auth_data.app)

        with Session(db.engine, expire_on_commit=False) as session:
            service = AppDslService(session)
            result = service.check_dependencies(app_model=app)

        return result, 200
