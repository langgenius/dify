from typing import Any

from langchain.tools import BraveSearch

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


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

        results = tool.run(query)

        if not results:
            return self.create_text_message(f"No results found for '{query}' in Tavily")
        else:
            return self.create_text_message(text=results)

