from flask_restx import Resource

from controllers.common.schema import register_response_schema_models
from controllers.web import web_ns
from libs.helper import dump_response
from services.feature_service import FeatureService, SystemFeatureModel

register_response_schema_models(web_ns, SystemFeatureModel)


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
        web_ns.models[SystemFeatureModel.__name__],
    )
    def get(self):
        """Get the non-sensitive bootstrap snapshot exposed before authentication.

        This endpoint is akin to the `SystemFeatureApi` endpoint in api/controllers/console/feature.py,
        except it is intended for use by the web app, instead of the console dashboard.

        Authentication configuration must be available before the authentication flow can be selected.
        """
        return dump_response(SystemFeatureModel, FeatureService.get_system_features())
