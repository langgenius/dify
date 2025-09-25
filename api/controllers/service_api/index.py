from flask.views import MethodView

from configs import dify_config


class IndexApi(MethodView):
    def get(self):
        return {
            "welcome": "Dify OpenAPI",
            "api_version": "v1",
            "server_version": dify_config.project.version,
        }
