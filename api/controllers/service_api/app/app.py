from typing import Any, cast

from flask_restx import Resource
from pydantic import Field
from sqlalchemy.orm import Session

from controllers.common.agent_app_parameters import get_published_agent_app_feature_dict_and_user_input_form
from controllers.common.fields import Parameters
from controllers.common.schema import register_response_schema_models
from controllers.service_api import service_api_ns
from controllers.service_api.app.error import AgentNotPublishedError, AppUnavailableError
from controllers.service_api.wraps import validate_app_token
from core.app.app_config.common.parameters_mapping import get_parameters_from_feature_dict
from core.app.apps.agent_app.errors import AgentAppGeneratorError, AgentAppNotPublishedError
from extensions.ext_database import db
from fields.base import ResponseModel
from models.model import App, AppMode, load_annotation_reply_config
from services.app_service import AppService


class AppInfoResponse(ResponseModel):
    name: str
    description: str | None
    tags: list[str]
    mode: str
    author_name: str | None


class AppMetaResponse(ResponseModel):
    tool_icons: dict[str, Any] = Field(default_factory=dict)


register_response_schema_models(service_api_ns, Parameters, AppMetaResponse, AppInfoResponse)


def _get_agent_app_feature_dict_and_user_input_form(
    app_model: App,
    *,
    session: Session,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    try:
        return get_published_agent_app_feature_dict_and_user_input_form(app_model, session=session)
    except AgentAppNotPublishedError:
        raise AgentNotPublishedError()
    except AgentAppGeneratorError:
        raise AppUnavailableError()


@service_api_ns.route("/parameters")
class AppParameterApi(Resource):
    """Resource for app variables."""

    @service_api_ns.doc(
        summary="Get App Parameters",
        description=(
            "Retrieve the application's input form configuration, including feature switches, input "
            "parameter names, types, and default values."
        ),
        tags=["Applications"],
        responses={
            200: "Application parameters information.",
            400: "`app_unavailable` : App unavailable or misconfigured.",
        },
    )
    @service_api_ns.doc("get_app_parameters")
    @service_api_ns.doc(description="Retrieve application input parameters and configuration")
    @service_api_ns.doc(
        responses={
            200: "Parameters retrieved successfully",
            401: "Unauthorized - invalid API token",
            404: "Application not found",
        }
    )
    @service_api_ns.response(200, "Parameters retrieved successfully", service_api_ns.models[Parameters.__name__])
    @validate_app_token
    def get(self, app_model: App):
        """Retrieve app parameters.

        Returns the input form parameters and configuration for the application.
        """
        session = db.session()
        features_dict: dict[str, Any]
        user_input_form: list[dict[str, Any]]
        if app_model.mode == AppMode.AGENT:
            features_dict, user_input_form = _get_agent_app_feature_dict_and_user_input_form(
                app_model,
                session=session,
            )
        elif app_model.mode in {AppMode.ADVANCED_CHAT, AppMode.WORKFLOW}:
            workflow = app_model.workflow_with_session(session=session)
            if workflow is None:
                raise AppUnavailableError()

            features_dict = workflow.features_dict
            user_input_form = workflow.user_input_form(to_old_structure=True)
        else:
            app_model_config = app_model.app_model_config_with_session(session=session)
            if app_model_config is None:
                raise AppUnavailableError()

            annotation_reply = load_annotation_reply_config(session, app_model.id)
            features_dict = cast(
                dict[str, Any],
                app_model_config.to_dict(annotation_reply=annotation_reply),
            )

            user_input_form = features_dict.get("user_input_form", [])

        parameters = get_parameters_from_feature_dict(features_dict=features_dict, user_input_form=user_input_form)
        return Parameters.model_validate(parameters).model_dump(mode="json")


@service_api_ns.route("/meta")
class AppMetaApi(Resource):
    @service_api_ns.doc(
        summary="Get App Meta",
        description="Retrieve metadata about this application, including tool icons and other configuration details.",
        tags=["Applications"],
        responses={
            200: "Successfully retrieved application meta information.",
        },
    )
    @service_api_ns.doc("get_app_meta")
    @service_api_ns.doc(description="Get application metadata")
    @service_api_ns.doc(
        responses={
            200: "Metadata retrieved successfully",
            401: "Unauthorized - invalid API token",
            404: "Application not found",
        }
    )
    @service_api_ns.response(200, "Metadata retrieved successfully", service_api_ns.models[AppMetaResponse.__name__])
    @validate_app_token
    def get(self, app_model: App):
        """Get app metadata.

        Returns metadata about the application including configuration and settings.
        """
        return AppService().get_app_meta(app_model, session=db.session())


@service_api_ns.route("/info")
class AppInfoApi(Resource):
    @service_api_ns.doc(
        summary="Get App Info",
        description="Retrieve basic information about this application, including name, description, tags, and mode.",
        tags=["Applications"],
        responses={
            200: "Basic information of the application.",
        },
    )
    @service_api_ns.doc("get_app_info")
    @service_api_ns.doc(description="Get basic application information")
    @service_api_ns.doc(
        responses={
            200: "Application info retrieved successfully",
            401: "Unauthorized - invalid API token",
            404: "Application not found",
        }
    )
    @service_api_ns.response(
        200,
        "Application info retrieved successfully",
        service_api_ns.models[AppInfoResponse.__name__],
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
