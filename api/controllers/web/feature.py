from flask.views import MethodView

from controllers.web import web_ns
from services.feature_service import FeatureService


@web_ns.route("/system-features")
class SystemFeatureApi(MethodView):
    @web_ns.doc("get_system_features")
    @web_ns.doc(description="Get system feature flags and configuration")
    @web_ns.doc(responses={200: "System features retrieved successfully", 500: "Internal server error"})
    def get(self):
        """Get system feature flags and configuration.

        Returns the current system feature flags and configuration
        that control various functionalities across the platform.

        Returns:
            dict: System feature configuration object
        """
        return FeatureService.get_system_features().model_dump()
