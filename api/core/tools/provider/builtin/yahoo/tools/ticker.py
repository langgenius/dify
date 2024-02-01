from typing import Any, Dict, List, Union

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool
from requests.exceptions import HTTPError, ReadTimeout
from yfinance import Ticker


class YahooFinanceSearchTickerTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: Dict[str, Any]) \
          -> Union[ToolInvokeMessage, List[ToolInvokeMessage]]:
        """
            invoke tools
        """
        query = tool_parameters.get('symbol', '')
        if not query:
            return self.create_text_message('Please input symbol')
        
        try:
            return self.create_text_message(self.run(ticker=query))
        except (HTTPError, ReadTimeout):
            return self.create_text_message(f'There is a internet connection problem. Please try again later.')
    
    def run(self, ticker: str) -> str:
        return str(Ticker(ticker).info)