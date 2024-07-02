from typing import Any, Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool

BING_SEARCH_API_URL = "https://api.bing.microsoft.com/v7.0/search"


class AzureBingSearchAPI:
    """
    AzureBingSearchAPI tool provider.
    """
    def __init__(self, api_key: str) -> None:
        """Initialize AzureBingSearchAPI tool provider."""
        self.bing_search_api_key = api_key

    def run(self, query: str, count: int, freshness: str, market: str, api_key: str) -> str:
        """Run query through AzureBingSearchAPI and parse result."""
        return self._process_response(self.results(query, count, freshness, market, api_key))

    def results(self, query: str, count: int, freshness: str, market: str, api_key: str) -> dict:
        """Run query through AzureBingSearchAPI and return the raw result."""
        headers = self.get_headers(api_key)
        params = self.get_params(query, count, freshness, market)
        response = requests.get(url=BING_SEARCH_API_URL, params=params, headers=headers)
        response.raise_for_status()
        return response.json()

    def get_headers(self, api_key: str) -> dict[str, str]:
        """Get parameters for AzureBingSearchAPI."""
        return {"Ocp-Apim-Subscription-Key": api_key}

    def get_params(self, query: str, count: int, freshness: str, market: str) -> dict[str, str]:
        """Get parameters for AzureBingSearchAPI."""
        params = {
            "q": query,
            "count": count,
            "freshness": freshness if freshness != "Unspecified" else None,
            "market": market,
            "textDecorations": False,
            "textFormat": "HTML"
        }
        return params

    @staticmethod
    def _process_response(response: dict) -> str:
        """
        Process response from AzureBingSearchAPI.
        AzureBingSearchAPI doc: https://learn.microsoft.com/en-us/bing/search-apis/bing-web-search/
        Bing search main results are called organic results
        """
        if "error" in response:
            raise ValueError(f"Got error from AzureBingSearchAPI: {response['error']}")

        result = {}
        if "value" in response["webPages"]:
            items = []
            for item in response["webPages"]["value"]:
                items.append({
                    "name": item.get("name", ""),
                    "url": item.get("url", ""),
                    "snippet": item.get("snippet", ""),
                    "language": item.get("language", ""),
                    "datePublished": item.get("datePublished", "")
                })
            result["webPages"] = {"value": items}
        return result


class AzureBingSearchTool(BuiltinTool):

    def _invoke(self,
                user_id: str,
                tool_parameters: dict[str, Any],
                ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
            invoke tools
        """
        query = tool_parameters['query']
        count = tool_parameters['count']
        freshness = tool_parameters['freshness']
        market = tool_parameters['market']
        api_key = self.runtime.credentials['bing_search_api_key']
        assert api_key
        result = AzureBingSearchAPI(api_key).run(query, count, freshness, market, api_key)
        return self.create_text_message(text=result)