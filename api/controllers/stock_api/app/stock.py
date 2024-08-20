from flask_restful import Resource

from configs import dify_config
from controllers.stock_api import api
from controllers.stock_api.wraps import get_stock_price, get_recent_stock_news, get_financial_data


class StockIndexApi(Resource):
    def get(self):
        return {
            "welcome": "Stock OpenAPI",
            "api_version": "v1",
            "server_version": dify_config.CURRENT_VERSION,
        }

class StockTicker(Resource):
    def get(self):
        return {
            "welcome": "Stock Ticker",
            "api_version": "v1",
            "server_version": dify_config.CURRENT_VERSION,
        }
        
class StockCompany(Resource):
    def get(self):
        return {
            "welcome": "Stock Info",
            "api_version": "v1",
            "server_version": dify_config.CURRENT_VERSION,
        }

api.add_resource(StockIndexApi, '/')
api.add_resource(StockTicker, '/ticker')
api.add_resource(StockCompany, '/company')
