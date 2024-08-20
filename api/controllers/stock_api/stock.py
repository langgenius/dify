from flask_restful import Resource

from configs import dify_config
from controllers.service_api import api
from controllers.service_api.wraps import get_stock_price, get_recent_stock_news, get_financial_data


class StockInfo(Resource):
    def get(self):
        return {
            "welcome": "StockApi",
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

api.add_resource(StockInfo, '/info')
api.add_resource(StockTicker, '/ticker')
