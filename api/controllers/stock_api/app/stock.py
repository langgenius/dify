from flask_restful import Resource
from flask import request, make_response

from configs import dify_config
from controllers.stock_api import api
from controllers.stock_api.wraps import get_stock_price, get_recent_stock_news, get_financial_data
import os
import logging

logger = logging.getLogger(__name__)

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

        # logger.info(f"ticker {type(company_data)} \n {company_data}")
        response = make_response(company_data)
        response.headers['Content-Type'] = 'text/plain; charset=utf-8'
        return response
        
class StockPrice(Resource):
    def get(self):
        ticker = request.args.get('ticker', '')
        
        result = get_stock_price(ticker)
        # logger.info(f"get_stock_price {type(result)} {result}")
        return f"{result}"
    
class StockNews(Resource):
    def get(self):
        ticker = request.args.get('ticker', '')

        result = get_recent_stock_news(ticker)
        # logger.info(f"get_recent_stock_news {type(result)} {result}")
        return result

class StockFinance(Resource):
    def get(self):
        ticker = request.args.get('ticker', '')
        
        result = get_financial_data(ticker)
        logger.info(f"get_financial_data {type(result)} {result}")
        return f"{result}"

api.add_resource(StockIndexApi, '/')
api.add_resource(StockTicker, '/ticker')
api.add_resource(StockPrice, '/price')
api.add_resource(StockNews, '/news')
api.add_resource(StockFinance, '/finance')
