"""DSL import/export for apps under /openapi/v1.

Endpoints
---------
POST /workspaces/<workspace_id>/apps/imports
    Import a DSL YAML string or URL into the specified workspace.

POST /workspaces/<workspace_id>/apps/imports/<import_id>/confirm
    Confirm a pending import after a DSL version mismatch acknowledgement.

GET /apps/<app_id>/export
    Export the current draft DSL of an app as a YAML string.

GET /apps/<app_id>/check-dependencies
    Return plugin dependencies referenced in the DSL that are not yet installed.

Auth notes
----------
Write endpoints use ``guard_workspace`` (workspace_id in path) so the auth
pipeline resolves the tenant and sets ``account.current_tenant`` before the
handler runs.  Read endpoints use ``guard`` with ``PATH_HAS_APP_ID``; the
pipeline loads the app and its tenant automatically.

Key collaborators: ``services.app_dsl_service.AppDslService``.
"""

from __future__ import annotations

from typing import cast

from flask import request
from flask_restx import Resource
from pydantic import ValidationError
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest

from controllers.common.schema import query_params_from_model
from controllers.openapi import openapi_ns
from controllers.openapi._models import AppDslExportQuery, AppDslImportPayload
from controllers.openapi.auth.composition import auth_router
from controllers.openapi.auth.data import AuthData
from extensions.ext_database import db
from libs.oauth_bearer import Scope, TokenType
from models import Account, App
from services.app_dsl_service import AppDslService, Import
from services.entities.dsl_entities import CheckDependenciesResult, ImportStatus


@openapi_ns.route("/workspaces/<string:workspace_id>/apps/imports")
class AppDslImportApi(Resource):
    """Import a DSL YAML string into the specified workspace.

    Use ``mode=yaml-content`` with ``yaml_content`` for inline YAML, or
    ``mode=yaml-url`` with ``yaml_url`` for a remote URL.  Provide ``app_id``
    to overwrite an existing workflow or advanced-chat app; omit it to create
    a new app.

    Returns 202 when the DSL version requires an explicit confirmation step
    (major version mismatch).  Callers must then POST to the confirm endpoint.
    Returns 400 when the import failed due to invalid DSL or a business error.
    """

    @openapi_ns.expect(openapi_ns.models[AppDslImportPayload.__name__])
    @openapi_ns.response(200, "Import completed", openapi_ns.models[Import.__name__])
    @openapi_ns.response(202, "Import pending confirmation", openapi_ns.models[Import.__name__])
    @openapi_ns.response(400, "Import failed", openapi_ns.models[Import.__name__])
    @auth_router.guard_workspace(
        scope=Scope.WORKSPACE_WRITE,
        allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}),
    )
    def post(self, workspace_id: str, *, auth_data: AuthData):
        body = request.get_json(silent=True) or {}
        try:
            payload = AppDslImportPayload.model_validate(body)
        except ValidationError as exc:
            raise BadRequest(str(exc))

        account = cast(Account, auth_data.caller)

        with Session(db.engine, expire_on_commit=False) as session:
            service = AppDslService(session)
            result = service.import_app(
                account=account,
                import_mode=payload.mode,
                yaml_content=payload.yaml_content,
                yaml_url=payload.yaml_url,
                name=payload.name,
                description=payload.description,
                icon_type=payload.icon_type,
                icon=payload.icon,
                icon_background=payload.icon_background,
                app_id=payload.app_id,
            )
            if result.status == ImportStatus.FAILED:
                session.rollback()
            else:
                session.commit()

        match result.status:
            case ImportStatus.FAILED:
                return result.model_dump(mode="json"), 400
            case ImportStatus.PENDING:
                return result.model_dump(mode="json"), 202
            case _:
                return result.model_dump(mode="json"), 200


@openapi_ns.route("/workspaces/<string:workspace_id>/apps/imports/<string:import_id>/confirm")
class AppDslImportConfirmApi(Resource):
    """Confirm a pending DSL import identified by ``import_id``.

    Required only when the initial import returned 202 (major DSL version
    mismatch that requires explicit acknowledgement).  The pending state is
    stored in Redis for 10 minutes; this call retrieves it and completes the
    import under the given workspace.

    Returns 400 when the pending data has expired or the import fails.
    """

    @openapi_ns.response(200, "Import confirmed", openapi_ns.models[Import.__name__])
    @openapi_ns.response(400, "Import failed", openapi_ns.models[Import.__name__])
    @auth_router.guard_workspace(
        scope=Scope.WORKSPACE_WRITE,
        allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}),
    )
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
            return result.model_dump(mode="json"), 400
        return result.model_dump(mode="json"), 200


@openapi_ns.route("/apps/<string:app_id>/export")
class AppDslExportApi(Resource):
    """Export an app's current draft configuration as a DSL YAML string.

    The auth pipeline resolves the app and its tenant from ``app_id``.  Pass
    ``include_secret=true`` to embed encrypted credential values (e.g. tool
    node secrets); omit it to produce a portable, sharable DSL safe to share.

    Note: the pipeline enforces ``app.enable_api`` for all ``/apps/<app_id>``
    routes in the openapi group.  Apps with the service API disabled will
    receive a 403; enable the API in the console first if needed.
    """

    @openapi_ns.doc(params=query_params_from_model(AppDslExportQuery))
    @openapi_ns.response(200, "Export successful")
    @auth_router.guard(
        scope=Scope.APPS_READ,
        allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}),
    )
    def get(self, app_id: str, *, auth_data: AuthData):
        try:
            query = AppDslExportQuery.model_validate(request.args.to_dict(flat=True))
        except ValidationError as exc:
            raise BadRequest(str(exc))

        app = cast(App, auth_data.app)
        data = AppDslService.export_dsl(
            app_model=app,
            include_secret=query.include_secret,
            workflow_id=query.workflow_id,
        )
        return {"data": data}, 200


@openapi_ns.route("/apps/<string:app_id>/check-dependencies")
class AppDslCheckDependenciesApi(Resource):
    """Check for leaked plugin dependencies after a DSL import.

    Call this after an import that reported ``COMPLETED_WITH_WARNINGS`` to
    find which plugin dependencies referenced in the DSL are not yet installed
    in the workspace.  Returns an empty ``leaked_dependencies`` list when all
    dependencies are satisfied.
    """

    @openapi_ns.response(200, "Dependencies checked", openapi_ns.models[CheckDependenciesResult.__name__])
    @auth_router.guard(
        scope=Scope.APPS_READ,
        allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}),
    )
    def get(self, app_id: str, *, auth_data: AuthData):
        app = cast(App, auth_data.app)

        with Session(db.engine, expire_on_commit=False) as session:
            service = AppDslService(session)
            result = service.check_dependencies(app_model=app)

        return result.model_dump(mode="json"), 200
