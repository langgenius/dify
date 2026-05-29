import logging

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field
from werkzeug.exceptions import Unauthorized

from constants import HEADER_NAME_APP_CODE
from controllers.common import fields
from controllers.common.schema import register_response_schema_models, register_schema_models
from core.app.app_config.common.parameters_mapping import AppParametersUnavailableError, get_app_parameters
from libs.passport import PassportService
from libs.token import extract_webapp_passport
from models.model import App, EndUser
from services.app_service import AppService
from services.enterprise.enterprise_service import EnterpriseService
from services.feature_service import FeatureService
from services.webapp_auth_service import WebAppAuthService

from . import web_ns
from .error import AppUnavailableError
from .wraps import WebApiResource

logger = logging.getLogger(__name__)


class AppAccessModeQuery(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    app_id: str | None = Field(default=None, alias="appId", description="Application ID")
    app_code: str | None = Field(default=None, alias="appCode", description="Application code")


register_schema_models(web_ns, AppAccessModeQuery)
register_response_schema_models(
    web_ns,
    fields.AccessModeResponse,
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
    def get(self, app_model: App, end_user: EndUser):
        """Retrieve app parameters."""
        try:
            parameters = get_app_parameters(app_model)
        except AppParametersUnavailableError:
            raise AppUnavailableError()
        return fields.Parameters.model_validate(parameters).model_dump(mode="json")


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
    def get(self, app_model: App, end_user: EndUser):
        """Get app meta"""
        return AppService().get_app_meta(app_model)


@web_ns.route("/webapp/access-mode")
class AppAccessMode(Resource):
    @web_ns.doc("Get App Access Mode")
    @web_ns.doc(description="Retrieve the access mode for a web application (public or restricted).")
    @web_ns.doc(
        params={
            "appId": {"description": "Application ID", "type": "string", "required": False},
            "appCode": {"description": "Application code", "type": "string", "required": False},
        }
    )
    @web_ns.doc(
        responses={
            200: "Success",
            400: "Bad Request",
            500: "Internal Server Error",
        }
    )
    @web_ns.response(200, "Success", web_ns.models[fields.AccessModeResponse.__name__])
    def get(self):
        raw_args = request.args.to_dict()
        args = AppAccessModeQuery.model_validate(raw_args)

        features = FeatureService.get_system_features()
        if not features.webapp_auth.enabled:
            return {"accessMode": "public"}

        app_id = args.app_id
        if args.app_code:
            app_id = AppService.get_app_id_by_code(args.app_code)

        if not app_id:
            raise ValueError("appId or appCode must be provided")

        res = EnterpriseService.WebAppAuth.get_app_access_mode_by_id(app_id)

        return {"accessMode": res.access_mode}


@web_ns.route("/webapp/permission")
class AppWebAuthPermission(Resource):
    @web_ns.doc("Check App Permission")
    @web_ns.doc(description="Check if user has permission to access a web application.")
    @web_ns.doc(params={"appId": {"description": "Application ID", "type": "string", "required": True}})
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

        require_permission_check = WebAppAuthService.is_app_require_permission_check(app_id=app_id)
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
        if WebAppAuthService.is_app_require_permission_check(app_id=app_id):
            res = EnterpriseService.WebAppAuth.is_user_allowed_to_access_webapp(str(user_id), app_id)
        return {"result": res}
