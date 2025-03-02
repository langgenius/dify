from controllers.common import fields
from controllers.common import helpers as controller_helpers
from controllers.service_api_with_auth import api
from controllers.service_api_with_auth.app.error import AppUnavailableError
from controllers.service_api_with_auth.wraps import validate_user_token_and_extract_info
from flask_restful import Resource, marshal_with  # type: ignore
from models.model import App, AppMode, EndUser
from services.app_service import AppService


class AppParameterApi(Resource):
    """Resource for app variables."""

    @validate_user_token_and_extract_info
    @marshal_with(fields.parameters_fields)
    def get(self, app_model: App, end_user: EndUser):
        """Retrieve app parameters.
        ---
        tags:
          - service/parameters
        summary: Get app parameters
        description: Retrieve parameters for the current application
        security:
          - ApiKeyAuth: []
        responses:
          200:
            description: Parameters retrieved successfully
            schema:
              type: object
          400:
            description: Invalid request
          401:
            description: Invalid or missing token
          404:
            description: App unavailable
        """
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


class AppMetaApi(Resource):
    @validate_user_token_and_extract_info
    def get(self, app_model: App, end_user: EndUser):
        """Get app meta information.
        ---
        tags:
          - service/meta
        summary: Get app meta
        description: Retrieve meta information for the current application
        security:
          - ApiKeyAuth: []
        responses:
          200:
            description: Meta information retrieved successfully
            schema:
              type: object
          401:
            description: Invalid or missing token
        """
        return AppService().get_app_meta(app_model)


class AppInfoApi(Resource):
    @validate_user_token_and_extract_info
    def get(self, app_model: App, end_user: EndUser):
        """Get app information.
        ---
        tags:
          - service/info
        summary: Get app info
        description: Retrieve basic information about the current application
        security:
          - ApiKeyAuth: []
        responses:
          200:
            description: App information retrieved successfully
            schema:
              type: object
              properties:
                name:
                  type: string
                description:
                  type: string
                tags:
                  type: array
                  items:
                    type: string
          401:
            description: Invalid or missing token
        """
        tags = [tag.name for tag in app_model.tags]
        return {"name": app_model.name, "description": app_model.description, "tags": tags}


api.add_resource(AppParameterApi, "/parameters")
api.add_resource(AppMetaApi, "/meta")
api.add_resource(AppInfoApi, "/info")
