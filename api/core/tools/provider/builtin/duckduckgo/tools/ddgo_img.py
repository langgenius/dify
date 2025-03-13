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
            "keywords": tool_parameters.get("query"),
            "timelimit": tool_parameters.get("timelimit"),
            "size": tool_parameters.get("size"),
            "max_results": tool_parameters.get("max_results"),
        }

        # Add query_prefix handling
        query_prefix = tool_parameters.get("query_prefix", "").strip()
        final_query = f"{query_prefix} {query_dict['keywords']}".strip()
        query_dict["keywords"] = final_query

        response = DDGS().images(**query_dict)
        markdown_result = "\n\n"
        json_result = []
        for res in response:
            markdown_result += f"![{res.get('title') or ''}]({res.get('image') or ''})"
            json_result.append(self.create_json_message(res))
        return [self.create_text_message(markdown_result)] + json_result
