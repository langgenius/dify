from http import HTTPStatus
from typing import Any

from flask_restx import Resource
from pydantic import BaseModel, Field

from controllers.common.fields import Parameters
from controllers.common.schema import register_response_schema_models
from controllers.console import console_ns
from controllers.console.app.error import AppUnavailableError
from controllers.console.explore.installed_app_admission import get_installed_app
from controllers.console.flask_admission import console_account_admission
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.external_api import error_responses
from libs.helper import dump_response
from machinery.context import RequestContext
from services.app_definition_query_service import AppDefinitionUnavailableError, WebAppConnectionRequirement
from services.installed_app_access_service import InstalledAppRef


class InstalledAppParametersResponse(Parameters, ResponseModel):
    connection_revision: str | None = Field(
        description="Opaque published authorization contract, as in Web App parameters."
    )
    requires_end_user_connections: bool = Field(
        description="Whether the published App requires explicit member Connection choices."
    )
    connection_requirements: tuple[WebAppConnectionRequirement, ...] = Field(
        description="Web App-compatible tool requirements. "
        "Installed App choices reference visible Workspace credentials."
    )


class ExploreAppMetaResponse(BaseModel):
    """Metadata consumed by the installed-app chat UI.

    Built-in tool icons are URL strings; API-based tool icons are provider-defined payload objects.
    """

    tool_icons: dict[str, str | dict[str, Any]] = Field(default_factory=dict)


register_response_schema_models(console_ns, InstalledAppParametersResponse, ExploreAppMetaResponse)


@console_ns.route("/installed-apps/<uuid:installed_app_id>/parameters", endpoint="installed_app_parameters")
class AppParameterApi(Resource):
    """Resource for app variables."""

    @error_responses(AppUnavailableError)
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[InstalledAppParametersResponse.__name__])
    @console_account_admission()
    @get_installed_app
    def get(self, request_context: RequestContext, installed_app: InstalledAppRef) -> dict[str, object]:
        """Retrieve app parameters."""
        try:
            parameters = application_services().app_definitions.get_web_parameters(
                installed_app.app_id, installed_app.app_owner_tenant_id
            )
        except AppDefinitionUnavailableError:
            raise AppUnavailableError() from None

        return dump_response(InstalledAppParametersResponse, parameters)


@console_ns.route("/installed-apps/<uuid:installed_app_id>/meta", endpoint="installed_app_meta")
class ExploreAppMetaApi(Resource):
    @error_responses(AppUnavailableError)
    @console_ns.response(HTTPStatus.OK, "Success", console_ns.models[ExploreAppMetaResponse.__name__])
    @console_account_admission()
    @get_installed_app
    def get(self, request_context: RequestContext, installed_app: InstalledAppRef) -> dict[str, object]:
        """Get app meta"""
        try:
            tool_icons = application_services().app_definitions.get_tool_icons(installed_app.app_id)
        except AppDefinitionUnavailableError:
            raise AppUnavailableError() from None

        return dump_response(
            ExploreAppMetaResponse,
            {"tool_icons": tool_icons},
        )
