from flask_restx import Resource
from pydantic import Field

from configs import dify_config
from controllers.common.schema import register_response_schema_models
from controllers.web import web_ns
from extensions.ext_application_services import application_services
from libs.helper import dump_response
from services.entities.feature_entities import SystemFeatureModel


class WebSystemFeatureResponse(SystemFeatureModel):
    """Extend public bootstrap with the Web-only Account sign-in entry point."""

    account_login_url: str | None = Field(
        description=(
            "Account-origin sign-in page for the existing Web App login flow; null when Account login is disabled."
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
        Account sign-in URL, preserving its base path, or null when disabled.
        Read deployment settings without issuing credentials or changing state;
        feature-query failures propagate unchanged.
        """
        return dump_response(
            WebSystemFeatureResponse,
            {
                **application_services().feature_queries.get_public_system_features().model_dump(mode="json"),
                "account_login_url": f"{dify_config.CONSOLE_WEB_URL.rstrip('/')}/signin"
                if dify_config.WEBAPP_ACCOUNT_PASSPORT_ENABLED
                else None,
            },
        )
