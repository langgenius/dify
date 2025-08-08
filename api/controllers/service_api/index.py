from flask_restful import Resource

from configs import dify_config
from controllers.service_api import api


class IndexApi(Resource):
    def get(self):
        return {
            "welcome": "Dify OpenAPI",
            "api_version": "v1",
            "server_version": dify_config.project.version,
        }


api.add_resource(IndexApi, "/")
