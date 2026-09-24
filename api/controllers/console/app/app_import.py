from http import HTTPStatus
from typing import BinaryIO, Literal, cast

from flask import request
from flask_restx import Resource
from pydantic import Field
from werkzeug.exceptions import Forbidden

from controllers.common.rbac import PlainApp, RBACCheck, Workspace
from controllers.common.schema import register_enum_models, register_response_schema_models, register_schema_models
from controllers.console.app.error import AppNotFoundError
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import RBACPermission, validate_request
from core.plugin.entities.plugin import PluginDependency
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from machinery.context import RequestContext
from models.account import TenantAccountRole
from services.agent.errors import InvalidRosterAgentPackageError
from services.app.console_service import ConsoleAppNotFoundError
from services.entities.dsl_entities import AppImportParams, CheckDependenciesResult, Import, ImportStatus
from services.errors.account import NoPermissionError

from .. import console_ns


class AppImportPayload(AppImportParams):
    pass


class RosterAgentPackageConflictResponse(ResponseModel):
    code: str
    message: str
    status: Literal[HTTPStatus.CONFLICT] = HTTPStatus.CONFLICT
    leaked_dependencies: list[PluginDependency] = Field(default_factory=list)


register_enum_models(console_ns, ImportStatus)
register_schema_models(console_ns, AppImportPayload, Import, CheckDependenciesResult)
register_response_schema_models(console_ns, RosterAgentPackageConflictResponse)


_EDIT_ROLES = frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR})


@console_ns.route("/apps/imports")
class AppImportApi(Resource):
    @console_ns.doc(
        params={
            "payload": {
                "required": True,
                "content": {
                    "application/json": {"schema": {"$ref": "#/definitions/AppImportPayload"}},
                    "multipart/form-data": {
                        "schema": {
                            "type": "object",
                            "properties": {
                                "file": {
                                    "type": "string",
                                    "format": "binary",
                                    "description": "App .ifpkg archive",
                                },
                                "app_id": {"type": "string", "description": "App to overwrite"},
                                "name": {"type": "string"},
                                "description": {"type": "string"},
                                "icon_type": {"type": "string"},
                                "icon": {"type": "string"},
                                "icon_background": {"type": "string"},
                            },
                            "required": ["file"],
                        }
                    },
                },
            }
        },
    )
    @console_ns.response(HTTPStatus.OK, "Import completed", console_ns.models[Import.__name__])
    @console_ns.response(HTTPStatus.ACCEPTED, "Import pending confirmation", console_ns.models[Import.__name__])
    @console_ns.response(HTTPStatus.BAD_REQUEST, "Import failed", console_ns.models[Import.__name__])
    @console_ns.response(HTTPStatus.FORBIDDEN, "Insufficient import or plugin installation permissions")
    @console_ns.response(
        HTTPStatus.CONFLICT,
        "Agent name conflict or missing plugins",
        console_ns.models[RosterAgentPackageConflictResponse.__name__],
    )
    @console_ns.response(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "Roster Agent package exceeds the size limit")
    @console_account_admission(allowed_roles=_EDIT_ROLES)
    def post(self, context: RequestContext):
        source: BinaryIO | None = None
        if request.mimetype == "multipart/form-data":
            uploaded = request.files.get("file")
            if uploaded is None or not uploaded.filename:
                raise InvalidRosterAgentPackageError("App package file is required")
            if not uploaded.filename.lower().endswith(".ifpkg"):
                raise InvalidRosterAgentPackageError("App package file must use the .ifpkg extension")
            source = cast(BinaryIO, uploaded.stream)
            payload = AppImportPayload.model_validate({**request.form.to_dict(), "mode": "yaml-content"})
        else:
            payload = validate_request(AppImportPayload)
        try:
            result = application_services().apps.console.import_app(context, payload, source=source)
        except NoPermissionError as exc:
            raise Forbidden(str(exc)) from exc
        status_code = {ImportStatus.FAILED: HTTPStatus.BAD_REQUEST, ImportStatus.PENDING: HTTPStatus.ACCEPTED}.get(
            result.status, HTTPStatus.OK
        )
        return result.model_dump(mode="json"), status_code


@console_ns.route("/apps/imports/<string:import_id>/confirm")
class AppImportConfirmApi(Resource):
    @console_ns.response(HTTPStatus.OK, "Import confirmed", console_ns.models[Import.__name__])
    @console_ns.response(HTTPStatus.BAD_REQUEST, "Import failed", console_ns.models[Import.__name__])
    @console_account_admission(
        allowed_roles=_EDIT_ROLES,
        rbac_checks=[RBACCheck(RBACPermission.APP_IMPORT_EXPORT_DSL, Workspace())],
    )
    def post(self, context: RequestContext, import_id: str):
        try:
            result = application_services().apps.console.confirm_import(context, import_id)
        except NoPermissionError as exc:
            raise Forbidden(str(exc)) from exc
        status_code = HTTPStatus.BAD_REQUEST if result.status == ImportStatus.FAILED else HTTPStatus.OK
        return result.model_dump(mode="json"), status_code


@console_ns.route("/apps/imports/<string:app_id>/check-dependencies")
class AppImportCheckDependenciesApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "Dependencies checked",
        console_ns.models[CheckDependenciesResult.__name__],
    )
    @console_account_admission(
        allowed_roles=_EDIT_ROLES,
        rbac_checks=[RBACCheck(RBACPermission.APP_VIEW_LAYOUT, PlainApp())],
    )
    def get(self, context: RequestContext, app_id: str):
        try:
            result = application_services().apps.console.check_import_dependencies(context, app_id)
        except ConsoleAppNotFoundError as exc:
            raise AppNotFoundError() from exc
        return result.model_dump(mode="json"), HTTPStatus.OK
