from flask_restful import marshal_with

from controllers.common import fields
from controllers.common import helpers as controller_helpers
from controllers.web import api
from controllers.web.error import AppUnavailableError
from controllers.web.wraps import WebApiResource
from models.model import App, AppMode
from services.app_service import AppService


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

        return controller_helpers.get_parameters_from_feature_dict(
            features_dict=features_dict, user_input_form=user_input_form
        )


class AppMeta(WebApiResource):
    def get(self, app_model: App, end_user):
        """Get app meta"""
        return AppService().get_app_meta(app_model)


api.add_resource(AppParameterApi, "/parameters")
api.add_resource(AppMeta, "/meta")
