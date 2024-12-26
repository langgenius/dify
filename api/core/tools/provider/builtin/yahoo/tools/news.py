from typing import Any, Union

import yfinance  # type: ignore
from requests.exceptions import HTTPError, ReadTimeout

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class YahooFinanceSearchTickerTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """

        query = tool_parameters.get("symbol", "")
        if not query:
            return self.create_text_message("Please input symbol")

        try:
            return self.run(ticker=query, user_id=user_id)
        except (HTTPError, ReadTimeout):
            return self.create_text_message("There is a internet connection problem. Please try again later.")

    def run(self, ticker: str, user_id: str) -> ToolInvokeMessage:
        company = yfinance.Ticker(ticker)
        try:
            if company.isin is None:
                return self.create_text_message(f"Company ticker {ticker} not found.")
        except (HTTPError, ReadTimeout, ConnectionError):
            return self.create_text_message(f"Company ticker {ticker} not found.")

        links = []
        try:
            links = [n["link"] for n in company.news if n["type"] == "STORY"]
        except (HTTPError, ReadTimeout, ConnectionError):
            if not links:
                return self.create_text_message(f"There is nothing about {ticker} ticker")
        if not links:
            return self.create_text_message(f"No news found for company that searched with {ticker} ticker.")

        result = "\n\n".join([self.get_url(link) for link in links])

        return self.create_text_message(self.summary(user_id=user_id, content=result))
