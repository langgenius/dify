from typing import Any

from duckduckgo_search import DDGS

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class DuckDuckGoSearchTool(BuiltinTool):
    """
    Tool for performing a search using DuckDuckGo search engine.
    """

    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage:
        query = tool_parameters.get('query', '')
        result_type = tool_parameters.get('result_type', 'text')
        max_results = tool_parameters.get('max_results', 10)
        require_summary = tool_parameters.get('require_summary', False)
        response = DDGS().text(query, max_results=max_results)

        if result_type == 'link':
            results = [f"[{res.get('title')}]({res.get('href')})" for res in response]
            results = "\n".join(results)
            return self.create_link_message(link=results)
        results = [res.get("body") for res in response]
        results = "\n".join(results)
        if require_summary:
            results = self.summary(user_id=user_id, content=results)
        return self.create_text_message(text=results)
