from flask_restful import Resource

from controllers.stock_api import api


class StockIndexApi(Resource):
    def get(self):
        return {
            "welcome": "Stock OpenAPI Index",
            "api_version": "v1",
        }

api.add_resource(StockIndexApi, '/')
