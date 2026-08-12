import logging
from typing import Any

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field
from werkzeug.exceptions import Unauthorized

from constants import HEADER_NAME_APP_CODE
from controllers.common import fields
from controllers.common.fields import AccessModeResponse, Parameters
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from extensions.ext_application_services import application_services
from extensions.ext_database import db
from libs.helper import dump_response
from libs.passport import PassportService
from libs.token import extract_webapp_passport
from models.model import App, EndUser
from services.app_definition_query_service import AppDefinitionNotPublishedError, AppDefinitionUnavailableError
from services.enterprise.enterprise_service import EnterpriseService
from services.feature_service import FeatureService
from services.webapp_auth_service import WebAppAuthService

from . import web_ns
from .error import AgentNotPublishedError, AppUnavailableError
from .wraps import WebApiResource

logger = logging.getLogger(__name__)


class AppAccessModeQuery(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    app_id: str | None = Field(default=None, alias="appId", description="Application ID")
    app_code: str | None = Field(default=None, alias="appCode", description="Application code")


class AppPermissionQuery(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    app_id: str = Field(..., alias="appId", description="Application ID")


class AppMetaResponse(BaseModel):
    tool_icons: dict[str, Any] = Field(
        default_factory=dict,
        description="Tool icon metadata keyed by tool name",
    )


register_schema_models(web_ns, AppAccessModeQuery, AppPermissionQuery)
register_response_schema_models(
    web_ns,
    Parameters,
    AppMetaResponse,
    AccessModeResponse,
    fields.BooleanResultResponse,
)


@web_ns.route("/parameters")
class AppParameterApi(WebApiResource):
    """Resource for app variables."""

    @web_ns.doc("Get App Parameters")
    @web_ns.doc(description="Retrieve the parameters for a specific app.")
    @web_ns.doc(
        responses={
            200: "Success",
            400: "Bad Request",
            401: "Unauthorized",
            403: "Forbidden",
            404: "App Not Found",
            500: "Internal Server Error",
        }
    )
    @web_ns.response(200, "Success", web_ns.models[Parameters.__name__])
    def get(self, app_model: App, end_user: EndUser):
        """Retrieve app parameters."""
        try:
            parameters = application_services().app_definitions.get_public_parameters(app_model.id)
        except AppDefinitionNotPublishedError:
            raise AgentNotPublishedError() from None
        except AppDefinitionUnavailableError:
            raise AppUnavailableError() from None

        return dump_response(Parameters, parameters)


@web_ns.route("/meta")
class AppMeta(WebApiResource):
    @web_ns.doc("Get App Meta")
    @web_ns.doc(description="Retrieve the metadata for a specific app.")
    @web_ns.doc(
        responses={
            200: "Success",
            400: "Bad Request",
            401: "Unauthorized",
            403: "Forbidden",
            404: "App Not Found",
            500: "Internal Server Error",
        }
    )
    @web_ns.response(200, "Success", web_ns.models[AppMetaResponse.__name__])
    def get(self, app_model: App, end_user: EndUser):
        """Get app meta"""
        try:
            tool_icons = application_services().app_definitions.get_tool_icons(app_model.id)
        except AppDefinitionUnavailableError:
            raise AppUnavailableError() from None

        return dump_response(AppMetaResponse, {"tool_icons": tool_icons})


@web_ns.route("/webapp/access-mode")
class AppAccessMode(Resource):
    @web_ns.doc("Get App Access Mode")
    @web_ns.doc(description="Retrieve the access mode for a web application (public or restricted).")
    @web_ns.doc(params=query_params_from_model(AppAccessModeQuery))
    @web_ns.doc(
        responses={
            200: "Success",
            400: "Bad Request",
            500: "Internal Server Error",
        }
    )
    @web_ns.response(200, "Success", web_ns.models[AccessModeResponse.__name__])
    def get(self):
        raw_args = request.args.to_dict()
        args = AppAccessModeQuery.model_validate(raw_args)
        access_mode = application_services().webapp_access.get_access_mode(
            app_id=args.app_id,
            app_code=args.app_code,
        )
        return dump_response(AccessModeResponse, {"access_mode": access_mode})


@web_ns.route("/webapp/permission")
class AppWebAuthPermission(Resource):
    @web_ns.doc("Check App Permission")
    @web_ns.doc(description="Check if user has permission to access a web application.")
    @web_ns.doc(params=query_params_from_model(AppPermissionQuery))
    @web_ns.doc(
        responses={
            200: "Success",
            400: "Bad Request",
            401: "Unauthorized",
            500: "Internal Server Error",
        }
    )
    @web_ns.response(200, "Success", web_ns.models[fields.BooleanResultResponse.__name__])
    def get(self):
        user_id = "visitor"
        app_code = request.headers.get(HEADER_NAME_APP_CODE)
        app_id = request.args.get("appId")
        if not app_id or not app_code:
            raise ValueError("appId must be provided")

        require_permission_check = WebAppAuthService.is_app_require_permission_check(
            app_id=app_id, session=db.session()
        )
        if not require_permission_check:
            return {"result": True}

        try:
            tk = extract_webapp_passport(app_code, request)
            if not tk:
                raise Unauthorized("Access token is missing.")
            decoded = PassportService().verify(tk)
            user_id = decoded.get("user_id", "visitor")
        except Unauthorized:
            raise
        except Exception:
            logger.exception("Unexpected error during auth verification")
            raise

        features = FeatureService.get_system_features()
        if not features.webapp_auth.enabled:
            return {"result": True}

        res = True
        if WebAppAuthService.is_app_require_permission_check(app_id=app_id, session=db.session()):
            res = EnterpriseService.WebAppAuth.is_user_allowed_to_access_webapp(str(user_id), app_id)
        return {"result": res}
