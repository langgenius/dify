from flask_restful import Resource

from controllers.stock import api


class StockIndexApi(Resource):
    def get(self):
        return {
            "welcome": "Stock OpenAPI",
            "api_version": "v1",
        }

api.add_resource(StockIndexApi, '/')
