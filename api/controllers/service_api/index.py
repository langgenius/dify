from flask_restful import Resource  # type: ignore

from configs import dify_config
from controllers.service_api import api


class IndexApi(Resource):
    def get(self):
        return {
            "welcome": "Dify OpenAPI",
            "api_version": "v1",
            "server_version": dify_config.CURRENT_VERSION,
        }


api.add_resource(IndexApi, "/")
