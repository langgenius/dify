from flask.views import MethodView

from configs import dify_config
from controllers.service_api import service_api_ns


@service_api_ns.route("/")
class IndexApi(MethodView):
    def get(self):
        return {
            "welcome": "Dify OpenAPI",
            "api_version": "v1",
            "server_version": dify_config.project.version,
        }
