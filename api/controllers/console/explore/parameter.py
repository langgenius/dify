from typing import Any

from pydantic import BaseModel, Field

from controllers.common.fields import Parameters
from controllers.common.schema import register_response_schema_models
from controllers.console import console_ns
from controllers.console.app.error import AppUnavailableError
from controllers.console.explore.wraps import InstalledAppResource
from extensions.ext_application_services import application_services
from libs.helper import dump_response
from models.model import InstalledApp
from services.app_definition_query_service import AppDefinitionUnavailableError


class ExploreAppMetaResponse(BaseModel):
    """Metadata consumed by the installed-app chat UI.

    Built-in tool icons are URL strings; API-based tool icons are provider-defined payload objects.
    """

    tool_icons: dict[str, str | dict[str, Any]] = Field(default_factory=dict)


register_response_schema_models(console_ns, Parameters, ExploreAppMetaResponse)


@console_ns.route("/installed-apps/<uuid:installed_app_id>/parameters", endpoint="installed_app_parameters")
class AppParameterApi(InstalledAppResource):
    """Resource for app variables."""

    @console_ns.response(200, "Success", console_ns.models[Parameters.__name__])
    def get(self, installed_app: InstalledApp):
        """Retrieve app parameters."""
        try:
            parameters = application_services().app_definitions.get_parameters(installed_app.app_id)
        except AppDefinitionUnavailableError:
            raise AppUnavailableError() from None

        return dump_response(Parameters, parameters)


@console_ns.route("/installed-apps/<uuid:installed_app_id>/meta", endpoint="installed_app_meta")
class ExploreAppMetaApi(InstalledAppResource):
    @console_ns.response(200, "Success", console_ns.models[ExploreAppMetaResponse.__name__])
    def get(self, installed_app: InstalledApp):
        """Get app meta"""
        try:
            tool_icons = application_services().app_definitions.get_tool_icons(installed_app.app_id)
        except AppDefinitionUnavailableError:
            raise AppUnavailableError() from None

        return dump_response(
            ExploreAppMetaResponse,
            {"tool_icons": tool_icons},
        )
