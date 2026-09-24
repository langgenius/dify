from flask_restx import Resource
from werkzeug.exceptions import Forbidden

from controllers.common.fields import Site as SiteResponse
from controllers.common.schema import register_response_schema_models
from controllers.service_api import service_api_ns
from controllers.service_api.wraps import validate_app_token
from extensions.ext_application_services import application_services
from libs.helper import dump_response
from models.model import App
from services.app_definition_query_service import AppDefinitionUnavailableError

register_response_schema_models(service_api_ns, SiteResponse)


@service_api_ns.route("/site")
class AppSiteApi(Resource):
    """Resource for app sites."""

    @service_api_ns.doc(
        summary="Get App WebApp Settings",
        description=(
            "Retrieve the WebApp settings of this application, including site configuration, theme, and "
            "customization options."
        ),
        tags=["Applications"],
        responses={
            200: "WebApp settings of the application.",
            403: "`forbidden` : Site not found for this application or the workspace has been archived.",
        },
    )
    @service_api_ns.doc("get_app_site")
    @service_api_ns.doc(description="Get application site configuration")
    @service_api_ns.doc(
        responses={
            200: "Site configuration retrieved successfully",
            401: "Unauthorized - invalid API token",
            403: "Forbidden - site not found or tenant archived",
        }
    )
    @service_api_ns.response(
        200,
        "Site configuration retrieved successfully",
        service_api_ns.models[SiteResponse.__name__],
    )
    @validate_app_token
    def get(self, app_model: App):
        """Retrieve app site info.

        Returns the site configuration for the application including theme, icons, and text.
        """
        try:
            configuration = application_services().app_definitions.get_site_configuration(app_model.id)
        except AppDefinitionUnavailableError:
            raise Forbidden() from None

        return dump_response(SiteResponse, configuration)
