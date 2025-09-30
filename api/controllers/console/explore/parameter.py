from flask_restx import marshal_with

from controllers.common import fields
from controllers.console import console_ns
from controllers.console.app.error import AppUnavailableError
from controllers.console.explore.wraps import InstalledAppResource
from core.app.app_config.common.parameters_mapping import get_parameters_from_feature_dict
from models.model import AppMode, InstalledApp
from services.app_service import AppService


@console_ns.route("/installed-apps/<uuid:installed_app_id>/parameters", endpoint="installed_app_parameters")
class AppParameterApi(InstalledAppResource):
    """Resource for app variables."""

    @marshal_with(fields.parameters_fields)
    def get(self, installed_app: InstalledApp):
        """Retrieve app parameters."""
        app_model = installed_app.app

        if app_model is None:
            raise AppUnavailableError()

        if app_model.mode in {AppMode.ADVANCED_CHAT, AppMode.WORKFLOW}:
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


@console_ns.route("/installed-apps/<uuid:installed_app_id>/meta", endpoint="installed_app_meta")
class ExploreAppMetaApi(InstalledAppResource):
    def get(self, installed_app: InstalledApp):
        """Get app meta"""
        app_model = installed_app.app
        if not app_model:
            raise ValueError("App not found")
        return AppService().get_app_meta(app_model)
