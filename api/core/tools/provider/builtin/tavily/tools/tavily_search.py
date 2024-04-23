from typing import Any

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool

TAVILY_API_URL = "https://api.tavily.com"


class TavilySearch:
    """
    A class for performing search operations using the Tavily Search API.

    Args:
        api_key (str): The API key for accessing the Tavily Search API.

    Methods:
        raw_results: Retrieves raw search results from the Tavily Search API.
        results: Retrieves cleaned search results from the Tavily Search API.
        clean_results: Cleans the raw search results.
    """

    def __init__(self, api_key: str) -> None:
        self.api_key = api_key

    def raw_results(self, params: dict[str, Any]) -> dict:
        """
        Retrieves raw search results from the Tavily Search API.

        Args:
            params (Dict[str, Any]): The search parameters.

        Returns:
            dict: The raw search results.

        """
        params["api_key"] = self.api_key
        if 'exclude_domains' in params and isinstance(params['exclude_domains'], str) and params['exclude_domains'] != 'None':
            params['exclude_domains'] = params['exclude_domains'].split()
        else:
            params['exclude_domains'] = []
        if 'include_domains' in params and isinstance(params['include_domains'], str) and params['include_domains'] != 'None':
            params['include_domains'] = params['include_domains'].split()
        else:
            params['include_domains'] = []
        
        response = requests.post(f"{TAVILY_API_URL}/search", json=params)
        response.raise_for_status()
        return response.json()

    def results(self, params: dict[str, Any]) -> list[dict]:
        """
        Retrieves cleaned search results from the Tavily Search API.

        Args:
            params (Dict[str, Any]): The search parameters.

        Returns:
            list: The cleaned search results.

        """
        raw_search_results = self.raw_results(params)
        return self.clean_results(raw_search_results["results"])

    def clean_results(self, results: list[dict]) -> list[dict]:
        """
        Cleans the raw search results.

        Args:
            results (list): The raw search results.

        Returns:
            list: The cleaned search results.

        """
        clean_results = []
        for result in results:
            clean_results.append(
                {
                    "url": result["url"],
                    "content": result["content"],
                }
            )
        # return clean results as a string
        return "\n".join([f"{res['url']}\n{res['content']}" for res in clean_results])


class TavilySearchTool(BuiltinTool):
    """
    A tool for searching Tavily using a given query.
    """

    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> ToolInvokeMessage | list[ToolInvokeMessage]:
        """
        Invokes the Tavily search tool with the given user ID and tool parameters.

        Args:
            user_id (str): The ID of the user invoking the tool.
            tool_parameters (Dict[str, Any]): The parameters for the Tavily search tool.

        Returns:
            ToolInvokeMessage | list[ToolInvokeMessage]: The result of the Tavily search tool invocation.
        """
        query = tool_parameters.get("query", "")

        api_key = self.runtime.credentials["tavily_api_key"]
        if not query:
            return self.create_text_message("Please input query")
        tavily_search = TavilySearch(api_key)
        results = tavily_search.results(tool_parameters)
        print(results)
        if not results:
            return self.create_text_message(f"No results found for '{query}' in Tavily")
        else:
            return self.create_text_message(text=results)