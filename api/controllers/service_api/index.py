from configs import dify_config
from controllers.service_api import service_api_ns
from quart_restx import Resource


@service_api_ns.route("/")
class IndexApi(Resource):
    def get(self):
        return {
            "welcome": "Dify OpenAPI",
            "api_version": "v1",
            "server_version": dify_config.project.version,
        }
