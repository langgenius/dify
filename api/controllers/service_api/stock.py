from flask_restful import Resource

from configs import dify_config
from controllers.service_api import api


class StockApi(Resource):
    def get(self):
        return {
            "welcome": "StockApi",
            "api_version": "v1",
            "server_version": dify_config.CURRENT_VERSION,
        }


api.add_resource(StockApi, '/stock')
