import logging
import os

# from controllers.search_api.wraps import search_data
from flask import request, make_response
from flask_restful import Resource

from configs import dify_config
from controllers.stock_api import api
from controllers.stock_api.wraps import get_stock_price, get_recent_stock_news, get_financial_data, search_data, \
    get_first_page_content

logger = logging.getLogger(__name__)

TICKERS_FILE_PATH = os.path.join(os.path.dirname(__file__), 'tickers.csv')


class StockIndexApi(Resource):
    def get(self):
        return {"welcome": "Stock OpenAPI", "api_version": "v1", "server_version": dify_config.CURRENT_VERSION, }


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


class SearchInfo(Resource):
    def get(self):
        # API_KEY = dify_config.GOOGLE_SEARCH_API_KEY
        # SEARCH_ENGINE_ID = dify_config.SEARCH_ENGINE_ID
        API_KEY = 'AIzaSyBMW6O-ZSAWdeMEnZSXa5q-QZd8UapHci4'
        SEARCH_ENGINE_ID = 'c74ab7df6d9754983'

        query = request.args.get('query', '')
        result = search_data(search_query=query, api_key=API_KEY, search_engine_id=SEARCH_ENGINE_ID, num_results=6)
        data_searched = get_first_page_content(result)
        return data_searched




api.add_resource(StockIndexApi, '/')
api.add_resource(StockTicker, '/ticker')
api.add_resource(StockPrice, '/price')
api.add_resource(StockNews, '/news')
api.add_resource(StockFinance, '/finance')
api.add_resource(SearchInfo, '/search_info')
