from typing import Any, Optional

from pydantic import BaseModel, Field

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class DuckDuckGoSearchAPIWrapper(BaseModel):
    """Wrapper for DuckDuckGo Search API.

    Free and does not require any setup.
    """

    region: Optional[str] = "wt-wt"
    safesearch: str = "moderate"
    time: Optional[str] = "y"
    max_results: int = 5

    def get_snippets(self, query: str) -> list[str]:
        """Run query through DuckDuckGo and return concatenated results."""
        from duckduckgo_search import DDGS

        with DDGS() as ddgs:
            results = ddgs.text(
                query,
                region=self.region,
                safesearch=self.safesearch,
                timelimit=self.time,
            )
            if results is None:
                return ["No good DuckDuckGo Search Result was found"]
            snippets = []
            for i, res in enumerate(results, 1):
                if res is not None:
                    snippets.append(res["body"])
                if len(snippets) == self.max_results:
                    break
        return snippets

    def run(self, query: str) -> str:
        snippets = self.get_snippets(query)
        return " ".join(snippets)

    def results(
        self, query: str, num_results: int, backend: str = "api"
    ) -> list[dict[str, str]]:
        """Run query through DuckDuckGo and return metadata.

        Args:
            query: The query to search for.
            num_results: The number of results to return.

        Returns:
            A list of dictionaries with the following keys:
                snippet - The description of the result.
                title - The title of the result.
                link - The link to the result.
        """
        from duckduckgo_search import DDGS

        with DDGS() as ddgs:
            results = ddgs.text(
                query,
                region=self.region,
                safesearch=self.safesearch,
                timelimit=self.time,
                backend=backend,
            )
            if results is None:
                return [{"Result": "No good DuckDuckGo Search Result was found"}]

            def to_metadata(result: dict) -> dict[str, str]:
                if backend == "news":
                    return {
                        "date": result["date"],
                        "title": result["title"],
                        "snippet": result["body"],
                        "source": result["source"],
                        "link": result["url"],
                    }
                return {
                    "snippet": result["body"],
                    "title": result["title"],
                    "link": result["href"],
                }

            formatted_results = []
            for i, res in enumerate(results, 1):
                if res is not None:
                    formatted_results.append(to_metadata(res))
                if len(formatted_results) == num_results:
                    break
        return formatted_results


class DuckDuckGoSearchRun(BaseModel):
    """Tool that queries the DuckDuckGo search API."""

    name = "duckduckgo_search"
    description = (
        "A wrapper around DuckDuckGo Search. "
        "Useful for when you need to answer questions about current events. "
        "Input should be a search query."
    )
    api_wrapper: DuckDuckGoSearchAPIWrapper = Field(
        default_factory=DuckDuckGoSearchAPIWrapper
    )

    def _run(
        self,
        query: str,
    ) -> str:
        """Use the tool."""
        return self.api_wrapper.run(query)


class DuckDuckGoSearchResults(BaseModel):
    """Tool that queries the DuckDuckGo search API and gets back json."""

    name = "DuckDuckGo Results JSON"
    description = (
        "A wrapper around Duck Duck Go Search. "
        "Useful for when you need to answer questions about current events. "
        "Input should be a search query. Output is a JSON array of the query results"
    )
    num_results: int = 4
    api_wrapper: DuckDuckGoSearchAPIWrapper = Field(
        default_factory=DuckDuckGoSearchAPIWrapper
    )
    backend: str = "api"

    def _run(
        self,
        query: str,
    ) -> str:
        """Use the tool."""
        res = self.api_wrapper.results(query, self.num_results, backend=self.backend)
        res_strs = [", ".join([f"{k}: {v}" for k, v in d.items()]) for d in res]
        return ", ".join([f"[{rs}]" for rs in res_strs])

class DuckDuckGoInput(BaseModel):
    query: str = Field(..., description="Search query.")

class DuckDuckGoSearchTool(BuiltinTool):
    """
    Tool for performing a search using DuckDuckGo search engine.
    """

    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage | list[ToolInvokeMessage]:
        """
        Invoke the DuckDuckGo search tool.

        Args:
            user_id (str): The ID of the user invoking the tool.
            tool_parameters (dict[str, Any]): The parameters for the tool invocation.

        Returns:
            ToolInvokeMessage | list[ToolInvokeMessage]: The result of the tool invocation.
        """
        query = tool_parameters.get('query', '')

        if not query:
            return self.create_text_message('Please input query')

        tool = DuckDuckGoSearchRun(args_schema=DuckDuckGoInput)

        result = tool._run(query)

        return self.create_text_message(self.summary(user_id=user_id, content=result))
    