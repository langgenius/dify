from typing import Any, Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool

ALPHAVANTAGE_API_URL = "https://www.alphavantage.co/query"


class QueryStockTool(BuiltinTool):

    def _invoke(self,
                user_id: str,
                tool_parameters: dict[str, Any],
                ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:

        stock_code = tool_parameters.get('code', '')
        if not stock_code:
            return self.create_text_message('Please tell me your stock code')

        if 'api_key' not in self.runtime.credentials or not self.runtime.credentials.get('api_key'):
            return self.create_text_message("Alpha Vantage API key is required.")

        params = {
            "function": "TIME_SERIES_DAILY",
            "symbol": stock_code,
            "outputsize": "compact",
            "datatype": "json",
            "apikey": self.runtime.credentials['api_key']
        }
        response = requests.get(url=ALPHAVANTAGE_API_URL, params=params)
        response.raise_for_status()
        result = self._handle_response(response.json())
        return self.create_json_message(result)

    def _handle_response(self, response: dict[str, Any]) -> dict[str, Any]:
        result = response.get('Time Series (Daily)', {})
        if not result:
            return {}
        stock_result = {}
        for k, v in result.items():
            stock_result[k] = {}
            stock_result[k]['open'] = v.get('1. open')
            stock_result[k]['high'] = v.get('2. high')
            stock_result[k]['low'] = v.get('3. low')
            stock_result[k]['close'] = v.get('4. close')
            stock_result[k]['volume'] = v.get('5. volume')
        return stock_result
