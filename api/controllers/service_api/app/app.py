from typing import Any

from flask_restx import Resource
from pydantic import Field

from controllers.common.fields import Parameters
from controllers.common.schema import register_response_schema_models
from controllers.service_api import service_api_ns
from controllers.service_api.app.error import AgentNotPublishedError, AppUnavailableError
from controllers.service_api.wraps import validate_app_token
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import dump_response
from models.model import App
from services.app_definition_query_service import AppDefinitionNotPublishedError, AppDefinitionUnavailableError


class AppInfoResponse(ResponseModel):
    name: str
    description: str | None
    tags: list[str]
    mode: str
    author_name: str | None


class AppMetaResponse(ResponseModel):
    tool_icons: dict[str, Any] = Field(default_factory=dict)


register_response_schema_models(service_api_ns, Parameters, AppMetaResponse, AppInfoResponse)


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
        try:
            parameters = application_services().app_definitions.get_public_parameters(app_model.id)
        except AppDefinitionNotPublishedError:
            raise AgentNotPublishedError() from None
        except AppDefinitionUnavailableError:
            raise AppUnavailableError() from None

        return dump_response(Parameters, parameters)


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
        try:
            tool_icons = application_services().app_definitions.get_tool_icons(app_model.id)
        except AppDefinitionUnavailableError:
            raise AppUnavailableError() from None

        return dump_response(AppMetaResponse, {"tool_icons": tool_icons})


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
        try:
            summary = application_services().app_definitions.get_summary(app_model.id)
        except AppDefinitionUnavailableError:
            raise AppUnavailableError() from None
        return dump_response(AppInfoResponse, summary)
