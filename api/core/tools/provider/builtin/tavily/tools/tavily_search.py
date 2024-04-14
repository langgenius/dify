from typing import Any, Optional

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

    def raw_results(
        self,
        query: str,
        max_results: Optional[int] = 3,
        search_depth: Optional[str] = "advanced",
        include_domains: Optional[list[str]] = [],
        exclude_domains: Optional[list[str]] = [],
        include_answer: Optional[bool] = False,
        include_raw_content: Optional[bool] = False,
        include_images: Optional[bool] = False,
    ) -> dict:
        """
        Retrieves raw search results from the Tavily Search API.

        Args:
            query (str): The search query.
            max_results (int, optional): The maximum number of results to retrieve. Defaults to 3.
            search_depth (str, optional): The search depth. Defaults to "advanced".
            include_domains (List[str], optional): The domains to include in the search. Defaults to [].
            exclude_domains (List[str], optional): The domains to exclude from the search. Defaults to [].
            include_answer (bool, optional): Whether to include answer in the search results. Defaults to False.
            include_raw_content (bool, optional): Whether to include raw content in the search results. Defaults to False.
            include_images (bool, optional): Whether to include images in the search results. Defaults to False.

        Returns:
            dict: The raw search results.

        """
        params = {
            "api_key": self.api_key,
            "query": query,
            "max_results": max_results,
            "search_depth": search_depth,
            "include_domains": include_domains,
            "exclude_domains": exclude_domains,
            "include_answer": include_answer,
            "include_raw_content": include_raw_content,
            "include_images": include_images,
        }
        response = requests.post(f"{TAVILY_API_URL}/search", json=params)
        response.raise_for_status()
        return response.json()

    def results(
        self,
        query: str,
        max_results: Optional[int] = 3,
        search_depth: Optional[str] = "advanced",
        include_domains: Optional[list[str]] = [],
        exclude_domains: Optional[list[str]] = [],
        include_answer: Optional[bool] = False,
        include_raw_content: Optional[bool] = False,
        include_images: Optional[bool] = False,
    ) -> list[dict]:
        """
        Retrieves cleaned search results from the Tavily Search API.

        Args:
            query (str): The search query.
            max_results (int, optional): The maximum number of results to retrieve. Defaults to 3.
            search_depth (str, optional): The search depth. Defaults to "advanced".
            include_domains (List[str], optional): The domains to include in the search. Defaults to [].
            exclude_domains (List[str], optional): The domains to exclude from the search. Defaults to [].
            include_answer (bool, optional): Whether to include answer in the search results. Defaults to False.
            include_raw_content (bool, optional): Whether to include raw content in the search results. Defaults to False.
            include_images (bool, optional): Whether to include images in the search results. Defaults to False.

        Returns:
            list: The cleaned search results.

        """
        raw_search_results = self.raw_results(
            query,
            max_results=max_results,
            search_depth=search_depth,
            include_domains=include_domains,
            exclude_domains=exclude_domains,
            include_answer=include_answer,
            include_raw_content=include_raw_content,
            include_images=include_images,
        )
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
        results = tavily_search.results(query)
        print(results)
        if not results:
            return self.create_text_message(f"No results found for '{query}' in Tavily")
        else:
            return self.create_text_message(text=results)
