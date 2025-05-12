from flask_restful import Resource, marshal_with

from controllers.common import fields
from controllers.service_api import api
from controllers.service_api.app.error import AppUnavailableError
from controllers.service_api.wraps import validate_app_token
from core.app.app_config.common.parameters_mapping import get_parameters_from_feature_dict
from models.model import App, AppMode
from services.app_service import AppService


class AppParameterApi(Resource):
    """Resource for app variables."""

    @validate_app_token
    @marshal_with(fields.parameters_fields)
    def get(self, app_model: App):
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


class AppMetaApi(Resource):
    @validate_app_token
    def get(self, app_model: App):
        """Get app meta"""
        return AppService().get_app_meta(app_model)


class AppInfoApi(Resource):
    @validate_app_token
    def get(self, app_model: App):
        """Get app information"""
        tags = [tag.name for tag in app_model.tags]
        return {"name": app_model.name, "description": app_model.description, "tags": tags, "mode": app_model.mode}


api.add_resource(AppParameterApi, "/parameters")
api.add_resource(AppMetaApi, "/meta")
api.add_resource(AppInfoApi, "/info")
