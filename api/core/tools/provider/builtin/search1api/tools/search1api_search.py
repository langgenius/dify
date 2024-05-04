import json
from typing import Any

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool

SEARCH_API_URL = "https://api.search1api.com"

class SearchAPIResults(dict):
    """Wrapper for search results."""

    def __init__(self, data: str):
        super().__init__(json.loads(data))
        self.__dict__ = self

    @property
    def results(self) -> Any:
        return self.get("results", [])

class SearchAPITool(BuiltinTool):
    """
    Tool for performing searches using Search1API.
    """

    def __init__(self):
        self.headers = None

    def set_api_key(self, api_key: str):
        self.headers = {"Authorization": f"Bearer {api_key}"}

    def _invoke_search(self, query: str, search_service: str, max_results: int, crawl_results: int, image: bool, gl: str, hl: str) -> list[dict]:
        """Run search query and return the results."""

        params = {
            "query": query,
            "search_service": search_service,
            "max_results": max_results,
            "crawl_results": crawl_results,
            "image": image,
            "gl": gl,
            "hl": hl
        }

        response = requests.post(f"{SEARCH_API_URL}/search", json=params, headers=self.headers)

        if response.status_code != 200:
            raise Exception(f'Error {response.status_code}: {response.text}')
        
        search_results = SearchAPIResults(response.text).results

        return search_results

    def _invoke_news(self, query: str, search_service: str, max_results: int, crawl_results: int, image: bool, gl: str, hl: str) -> list[dict]:
        """Run news search query and return the results."""

        params = {
            "query": query,
            "search_service": search_service,
            "max_results": max_results,
            "crawl_results": crawl_results,
            "image": image,
            "gl": gl,
            "hl": hl
        }

        response = requests.post(f"{SEARCH_API_URL}/news", json=params, headers=self.headers)

        if response.status_code != 200:
            raise Exception(f'Error {response.status_code}: {response.text}')
        
        search_results = SearchAPIResults(response.text).results

        return search_results


    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage | list[ToolInvokeMessage]:
        """
        Invoke the Search1API tool.

        Args:
            user_id (str): The ID of the user invoking the tool.
            tool_parameters (dict[str, Any]): The parameters for the tool invocation.

        Returns:
            ToolInvokeMessage | list[ToolInvokeMessage]: The result of the tool invocation.
        """

        api_key = self.runtime.credentials.get('search_api_key', None)
        if not api_key:
            raise Exception('Search1API key is required')
        
        self.set_api_key(api_key)

        action = tool_parameters.get('action', 'search').lower()

        if action == 'search' or action == 'news':
            query = tool_parameters.get('query', None)
            if not query:
                return self.create_text_message('Please input query')
            
            search_service = tool_parameters.get('search_service', 'google')
            max_results = min(tool_parameters.get('max_results', 5), 100)
            crawl_results = min(tool_parameters.get('crawl_results', 0), 10)
            image = tool_parameters.get('image', False)
            gl = tool_parameters.get('gl', '')
            hl = tool_parameters.get('hl', '')

            if action == 'search':
                results = self._invoke_search(query, search_service, max_results, crawl_results, image, gl, hl)
            else:
                results = self._invoke_news(query, search_service, max_results, crawl_results, image, gl, hl)

            result_messages = []
            for result in results:
                title = result.get('title', '')
                link = result.get('link', '')
                snippet = result.get('snippet', '')
                content = result.get('content', '')

                result_messages.append(self.create_text_message(
                    text=f"{title}\n{link}\n{snippet}\n{content}"
                ))

            return result_messages
            

        else:
            return self.create_text_message('Invalid action')