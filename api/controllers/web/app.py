from flask import request
from flask_restful import Resource, marshal_with, reqparse
from werkzeug.exceptions import Unauthorized

from controllers.common import fields
from controllers.web import api
from controllers.web.error import AppUnavailableError
from controllers.web.wraps import WebApiResource
from core.app.app_config.common.parameters_mapping import get_parameters_from_feature_dict
from libs.passport import PassportService
from models.model import App, AppMode
from services.app_service import AppService
from services.enterprise.enterprise_service import EnterpriseService
from services.feature_service import FeatureService
from services.webapp_auth_service import WebAppAuthService


class AppParameterApi(WebApiResource):
    """Resource for app variables."""

    @marshal_with(fields.parameters_fields)
    def get(self, app_model: App, end_user):
        """Retrieve app parameters."""
        if app_model.mode in {AppMode.ADVANCED_CHAT.value, AppMode.WORKFLOW.value}:
            workflow = app_model.workflow
            if workflow is None:
                raise AppUnavailableError()

            features_dict = workflow.features_dict
            user_input_form = workflow.user_input_form(to_old_structure=True)
        else:
            app_model_config = app_model.app_model_config
            if app_model_config is None:
                raise AppUnavailableError()

            features_dict = app_model_config.to_dict()

            user_input_form = features_dict.get("user_input_form", [])

        return get_parameters_from_feature_dict(features_dict=features_dict, user_input_form=user_input_form)


class AppMeta(WebApiResource):
    def get(self, app_model: App, end_user):
        """Get app meta"""
        return AppService().get_app_meta(app_model)


class AppAccessMode(Resource):
    def get(self):
        parser = reqparse.RequestParser()
        parser.add_argument("appId", type=str, required=False, location="args")
        parser.add_argument("appCode", type=str, required=False, location="args")
        args = parser.parse_args()

        features = FeatureService.get_system_features()
        if not features.webapp_auth.enabled:
            return {"accessMode": "public"}

        app_id = args.get("appId")
        if args.get("appCode"):
            app_code = args["appCode"]
            app_id = AppService.get_app_id_by_code(app_code)

        if not app_id:
            raise ValueError("appId or appCode must be provided")

        res = EnterpriseService.WebAppAuth.get_app_access_mode_by_id(app_id)

        return {"accessMode": res.access_mode}


class AppWebAuthPermission(Resource):
    def get(self):
        user_id = "visitor"
        try:
            auth_header = request.headers.get("Authorization")
            if auth_header is None:
                raise Unauthorized("Authorization header is missing.")
            if " " not in auth_header:
                raise Unauthorized("Invalid Authorization header format. Expected 'Bearer <api-key>' format.")

            auth_scheme, tk = auth_header.split(None, 1)
            auth_scheme = auth_scheme.lower()
            if auth_scheme != "bearer":
                raise Unauthorized("Authorization scheme must be 'Bearer'")

            decoded = PassportService().verify(tk)
            user_id = decoded.get("user_id", "visitor")
        except Exception as e:
            pass

        features = FeatureService.get_system_features()
        if not features.webapp_auth.enabled:
            return {"result": True}

        parser = reqparse.RequestParser()
        parser.add_argument("appId", type=str, required=True, location="args")
        args = parser.parse_args()

        app_id = args["appId"]
        app_code = AppService.get_app_code_by_id(app_id)

        res = True
        if WebAppAuthService.is_app_require_permission_check(app_id=app_id):
            res = EnterpriseService.WebAppAuth.is_user_allowed_to_access_webapp(str(user_id), app_code)
        return {"result": res}


api.add_resource(AppParameterApi, "/parameters")
api.add_resource(AppMeta, "/meta")
# webapp auth apis
api.add_resource(AppAccessMode, "/webapp/access-mode")
api.add_resource(AppWebAuthPermission, "/webapp/permission")
