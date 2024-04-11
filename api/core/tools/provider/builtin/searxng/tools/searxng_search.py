import json
import requests

from typing import Any, List, Dict

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class SearXNGSearchResults(dict):
    """Wrapper for search results."""

    def __init__(self, data: str):
        super().__init__(json.loads(data))
        self.__dict__ = self

    @property
    def results(self) -> Any:
        return self.get("results", [])


class SearXNGSearchTool(BuiltinTool):
    """
    Tool for performing a search using SearXNG engine.
    """

    def _invoke_query(self, user_id: str, host: str, query: str, result_type: str, topK: int = 5) -> List[Dict]:
        """Run query and return the results."""

        response = requests.get(host, params={"format": "json", "q": query})

        if response.status_code != 200:
            raise Exception(f'Error {response.status_code}: {response.text}')
        
        search_results = SearXNGSearchResults(response.text).results[:topK]

        if result_type == 'link':
            results = []
            for r in search_results:
                results.append(self.create_text_message(
                    text=f'{r["title"]}: {r["url"]}'
                ))

            return results
        else:
            text = ''
            for i, r in enumerate(search_results):
                text += f'{i+1}: {r["title"]} - {r.get("content", "")}\n'

            return self.create_text_message(text=self.summary(user_id=user_id, content=text))


    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage | list[ToolInvokeMessage]:
        """
        Invoke the SearXNG search tool.

        Args:
            user_id (str): The ID of the user invoking the tool.
            tool_parameters (dict[str, Any]): The parameters for the tool invocation.

        Returns:
            ToolInvokeMessage | list[ToolInvokeMessage]: The result of the tool invocation.
        """

        host = self.runtime.credentials.get('searxng_base_url', None)
        if not host:
            raise Exception('SearXNG api is required')
                
        query = tool_parameters.get('query', None)
        if not query:
            return self.create_text_message('Please input query')
                
        limit = min(tool_parameters.get('limit', 5), 20)
        result_type = tool_parameters.get('result_type', 'text') or 'text'

        return self._invoke_query(user_id=user_id, host=host, query=query, result_type=result_type, topK=limit)