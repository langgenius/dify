import json
from typing import Any, Optional

import requests
from pydantic import BaseModel, Field

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class BraveSearchWrapper(BaseModel):
    """Wrapper around the Brave search engine."""

    api_key: str
    """The API key to use for the Brave search engine."""
    search_kwargs: dict = Field(default_factory=dict)
    """Additional keyword arguments to pass to the search request."""
    base_url: str = "https://api.search.brave.com/res/v1/web/search"
    """The base URL for the Brave search engine."""

    def run(self, query: str) -> str:
        """Query the Brave search engine and return the results as a JSON string.

        Args:
            query: The query to search for.

        Returns: The results as a JSON string.

        """
        web_search_results = self._search_request(query=query)
        final_results = [
            {
                "title": item.get("title"),
                "link": item.get("url"),
                "snippet": item.get("description"),
            }
            for item in web_search_results
        ]
        return json.dumps(final_results)
    
    def _search_request(self, query: str) -> list[dict]:
        headers = {
            "X-Subscription-Token": self.api_key,
            "Accept": "application/json",
        }
        req = requests.PreparedRequest()
        params = {**self.search_kwargs, **{"q": query}}
        req.prepare_url(self.base_url, params)
        if req.url is None:
            raise ValueError("prepared url is None, this should not happen")

        response = requests.get(req.url, headers=headers)
        if not response.ok:
            raise Exception(f"HTTP error {response.status_code}")

        return response.json().get("web", {}).get("results", [])

class BraveSearch(BaseModel):
    """Tool that queries the BraveSearch."""

    name: str = "brave_search"
    description: str = (
        "a search engine. "
        "useful for when you need to answer questions about current events."
        " input should be a search query."
    )
    search_wrapper: BraveSearchWrapper

    @classmethod
    def from_api_key(
        cls, api_key: str, search_kwargs: Optional[dict] = None, **kwargs: Any
    ) -> "BraveSearch":
        """Create a tool from an api key.

        Args:
            api_key: The api key to use.
            search_kwargs: Any additional kwargs to pass to the search wrapper.
            **kwargs: Any additional kwargs to pass to the tool.

        Returns:
            A tool.
        """
        wrapper = BraveSearchWrapper(api_key=api_key, search_kwargs=search_kwargs or {})
        return cls(search_wrapper=wrapper, **kwargs)

    def _run(
        self,
        query: str,
    ) -> str:
        """Use the tool."""
        return self.search_wrapper.run(query)

class BraveSearchTool(BuiltinTool):
    """
    Tool for performing a search using Brave search engine.
    """

    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage | list[ToolInvokeMessage]:
        """
        Invoke the Brave search tool.

        Args:
            user_id (str): The ID of the user invoking the tool.
            tool_parameters (dict[str, Any]): The parameters for the tool invocation.

        Returns:
            ToolInvokeMessage | list[ToolInvokeMessage]: The result of the tool invocation.
        """
        query = tool_parameters.get('query', '')
        count = tool_parameters.get('count', 3)
        api_key = self.runtime.credentials['brave_search_api_key']

        if not query:
            return self.create_text_message('Please input query')

        tool = BraveSearch.from_api_key(api_key=api_key, search_kwargs={"count": count})

        results = tool._run(query)

        if not results:
            return self.create_text_message(f"No results found for '{query}' in Tavily")
        else:
            return self.create_text_message(text=results)

