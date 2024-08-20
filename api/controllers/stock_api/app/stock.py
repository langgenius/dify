from flask_restful import Resource

from configs import dify_config
from controllers.stock_api import api
from controllers.stock_api.wraps import get_stock_price, get_recent_stock_news, get_financial_data
import os


TICKERS_FILE_PATH = os.path.join(os.path.dirname(__file__), 'tickers.csv')

class StockIndexApi(Resource):
    def get(self):
        return {
            "welcome": "Stock OpenAPI",
            "api_version": "v1",
            "server_version": dify_config.CURRENT_VERSION,
        }

class StockTicker(Resource):
    def get(self):
        with open(TICKERS_FILE_PATH, 'r') as file:
            company_data = file.read()      
        return company_data
        
class StockPrice(Resource):
    def get(self):
        return get_stock_price("VCB")
    
class StockNews(Resource):
    def get(self):
        return get_recent_stock_news("VCB")

class StockFinancial(Resource):
    def get(self):
        return get_financial_data("VCB")

api.add_resource(StockIndexApi, '/')
api.add_resource(StockTicker, '/ticker')
api.add_resource(StockPrice, '/price')
api.add_resource(StockNews, '/news')
api.add_resource(StockFinancial, '/financial')
