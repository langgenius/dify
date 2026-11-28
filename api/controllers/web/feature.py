from flask_restx import Resource
from pydantic import Field

from configs import dify_config
from controllers.common.schema import register_response_schema_models
from controllers.web import web_ns
from extensions.ext_application_services import application_services
from libs.helper import dump_response
from services.entities.feature_entities import SystemFeatureModel


class WebSystemFeatureResponse(SystemFeatureModel):
    """Extend public bootstrap with the Web-only Account login entry point."""

    console_web_url: str = Field(
        description=(
            "Web console base URL, preserving its deployment base path; independent of whether Account login "
            "is enabled. An empty string means the same-origin root."
        ),
    )


register_response_schema_models(web_ns, WebSystemFeatureResponse)


@web_ns.route("/system-features")
class SystemFeatureApi(Resource):
    @web_ns.doc("get_system_features")
    @web_ns.doc(
        description="Get the non-sensitive bootstrap snapshot exposed before Console or Web authentication. "
        "This is not a general feature registry."
    )
    @web_ns.doc(responses={200: "System features retrieved successfully", 500: "Internal server error"})
    @web_ns.response(
        200,
        "System features retrieved successfully",
        web_ns.models[WebSystemFeatureResponse.__name__],
    )
    def get(self):
        """Get the non-sensitive bootstrap snapshot exposed before authentication.

        This endpoint is akin to the `SystemFeatureApi` endpoint in api/controllers/console/feature.py,
        except it is intended for use by the web app, instead of the console dashboard.

        Authentication configuration must be available before the authentication flow can be selected.
        No Account, App Passport, or app code is required. Return the configured
        Web console endpoint URL, independent of login enablement, so clients can
        compose the Account sign-in route. Preserve deployment base paths.
        Read deployment settings without issuing credentials or changing state;
        feature-query failures propagate unchanged.
        """
        return dump_response(
            WebSystemFeatureResponse,
            {
                **application_services().feature_queries.get_public_system_features().model_dump(mode="json"),
                "console_web_url": dify_config.CONSOLE_WEB_URL.rstrip("/"),
            },
        )
