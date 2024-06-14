from typing import Any

from duckduckgo_search import DDGS

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class DuckDuckGoImageSearchTool(BuiltinTool):
    """
    Tool for performing an image search using DuckDuckGo search engine.
    """

    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> list[ToolInvokeMessage]:
        query_dict = {
            "keywords": tool_parameters.get('query'),
            "timelimit": tool_parameters.get('timelimit'),
            "size": tool_parameters.get('size'),
            "max_results": tool_parameters.get('max_results'),
        }
        response = DDGS().images(**query_dict)
        results = []
        for res in response:
            results.append(self.create_image_message(image=res.get("image")))
        return results
