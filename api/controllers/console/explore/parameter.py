from flask_restful import marshal_with  # type: ignore

from controllers.common import fields
from controllers.common import helpers as controller_helpers
from controllers.console import api
from controllers.console.app.error import AppUnavailableError
from controllers.console.explore.wraps import InstalledAppResource
from models.model import AppMode, InstalledApp
from services.app_service import AppService


class AppParameterApi(InstalledAppResource):
    """Resource for app variables."""

    @marshal_with(fields.parameters_fields)
    def get(self, installed_app: InstalledApp):
        """Retrieve app parameters."""
        app_model = installed_app.app

        if app_model is None:
            raise AppUnavailableError()

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


class ExploreAppMetaApi(InstalledAppResource):
    def get(self, installed_app: InstalledApp):
        """Get app meta"""
        app_model = installed_app.app
        return AppService().get_app_meta(app_model)


api.add_resource(
    AppParameterApi, "/installed-apps/<uuid:installed_app_id>/parameters", endpoint="installed_app_parameters"
)
api.add_resource(ExploreAppMetaApi, "/installed-apps/<uuid:installed_app_id>/meta", endpoint="installed_app_meta")
