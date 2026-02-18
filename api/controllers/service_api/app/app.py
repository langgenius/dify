from flask_restx import Resource

from controllers.common.fields import Parameters
from controllers.service_api import service_api_ns
from controllers.service_api.app.error import AppUnavailableError
from controllers.service_api.wraps import validate_app_token
from core.app.app_config.common.parameters_mapping import get_parameters_from_feature_dict
from models.model import App, AppMode
from services.app_service import AppService


@service_api_ns.route("/parameters")
class AppParameterApi(Resource):
    """Resource for app variables."""

    @service_api_ns.doc("get_app_parameters")
    @service_api_ns.doc(description="Retrieve application input parameters and configuration")
    @service_api_ns.doc(
        responses={
            200: "Parameters retrieved successfully",
            401: "Unauthorized - invalid API token",
            404: "Application not found",
        }
    )
    @validate_app_token
    def get(self, app_model: App):
        """Retrieve app parameters.

        Returns the input form parameters and configuration for the application.
        """
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

        parameters = get_parameters_from_feature_dict(features_dict=features_dict, user_input_form=user_input_form)
        return Parameters.model_validate(parameters).model_dump(mode="json")


@service_api_ns.route("/meta")
class AppMetaApi(Resource):
    @service_api_ns.doc("get_app_meta")
    @service_api_ns.doc(description="Get application metadata")
    @service_api_ns.doc(
        responses={
            200: "Metadata retrieved successfully",
            401: "Unauthorized - invalid API token",
            404: "Application not found",
        }
    )
    @validate_app_token
    def get(self, app_model: App):
        """Get app metadata.

        Returns metadata about the application including configuration and settings.
        """
        return AppService().get_app_meta(app_model)


@service_api_ns.route("/info")
class AppInfoApi(Resource):
    @service_api_ns.doc("get_app_info")
    @service_api_ns.doc(description="Get basic application information")
    @service_api_ns.doc(
        responses={
            200: "Application info retrieved successfully",
            401: "Unauthorized - invalid API token",
            404: "Application not found",
        }
    )
    @validate_app_token
    def get(self, app_model: App):
        """Get app information.

        Returns basic information about the application including name, description, tags, and mode.
        """
        tags = [tag.name for tag in app_model.tags]
        return {
            "name": app_model.name,
            "description": app_model.description,
            "tags": tags,
            "mode": app_model.mode,
            "author_name": app_model.author_name,
        }
