from typing import Any

from duckduckgo_search import DDGS

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class DuckDuckGoAITool(BuiltinTool):
    """
    Tool for performing a search using DuckDuckGo search engine.
    """

    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage:
        query_dict = {
            "keywords": tool_parameters.get("query"),
            "model": tool_parameters.get("model"),
        }
        response = DDGS().chat(**query_dict)
        return self.create_text_message(text=response)
