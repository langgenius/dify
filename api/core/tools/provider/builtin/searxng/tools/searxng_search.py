import json
from typing import Any

import requests

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

    SEARCH_TYPE = {
        "page": "general",
        "news": "news",
        "image": "images",
        # "video": "videos",
        # "file": "files"
    }
    LINK_FILED = {
        "page": "url",
        "news": "url",
        "image": "img_src",
        # "video": "iframe_src",
        # "file": "magnetlink"
    }
    TEXT_FILED = {
        "page": "content",
        "news": "content",
        "image": "img_src",
        # "video": "iframe_src",
        # "file": "magnetlink"
    }

    def _invoke_query(self, user_id: str, host: str, query: str, search_type: str, result_type: str, topK: int = 5) -> list[dict]:
        """Run query and return the results."""

        search_type = search_type.lower()
        if search_type not in self.SEARCH_TYPE.keys():
            search_type= "page"

        response = requests.get(host, params={
            "q": query, 
            "format": "json", 
            "categories": self.SEARCH_TYPE[search_type]
        })

        if response.status_code != 200:
            raise Exception(f'Error {response.status_code}: {response.text}')
        
        search_results = SearXNGSearchResults(response.text).results[:topK]

        if result_type == 'link':
            results = []
            if search_type == "page" or search_type == "news":
                for r in search_results:
                    results.append(self.create_text_message(
                        text=f'{r["title"]}: {r.get(self.LINK_FILED[search_type], "")}'
                    ))
            elif search_type == "image":
                for r in search_results:
                    results.append(self.create_image_message(
                        image=r.get(self.LINK_FILED[search_type], "")
                    ))
            else:
                for r in search_results:
                    results.append(self.create_link_message(
                        link=r.get(self.LINK_FILED[search_type], "")
                    ))

            return results
        else:
            text = ''
            for i, r in enumerate(search_results):
                text += f'{i+1}: {r["title"]} - {r.get(self.TEXT_FILED[search_type], "")}\n'

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
                
        num_results = min(tool_parameters.get('num_results', 5), 20)
        search_type = tool_parameters.get('search_type', 'page') or 'page'
        result_type = tool_parameters.get('result_type', 'text') or 'text'

        return self._invoke_query(
            user_id=user_id, 
            host=host, 
            query=query, 
            search_type=search_type, 
            result_type=result_type, 
            topK=num_results)