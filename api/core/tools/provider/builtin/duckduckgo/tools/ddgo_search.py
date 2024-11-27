from typing import Any

from duckduckgo_search import DDGS

from core.model_runtime.entities.message_entities import SystemPromptMessage
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool

SUMMARY_PROMPT = """
User's query:
{query}

Here is the search engine result:
{content}

Please summarize the result in a few sentences.
"""


class DuckDuckGoSearchTool(BuiltinTool):
    """
    Tool for performing a search using DuckDuckGo search engine.
    """

    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage | list[ToolInvokeMessage]:
        query = tool_parameters.get("query")
        max_results = tool_parameters.get("max_results", 5)
        require_summary = tool_parameters.get("require_summary", False)

        # Add query_prefix handling
        query_prefix = tool_parameters.get("query_prefix", "").strip()
        final_query = f"{query_prefix} {query}".strip()

        response = DDGS().text(final_query, max_results=max_results)
        if require_summary:
            results = "\n".join([res.get("body") for res in response])
            results = self.summary_results(user_id=user_id, content=results, query=query)
            return self.create_text_message(text=results)
        return [self.create_json_message(res) for res in response]

    def summary_results(self, user_id: str, content: str, query: str) -> str:
        prompt = SUMMARY_PROMPT.format(query=query, content=content)
        summary = self.invoke_model(
            user_id=user_id,
            prompt_messages=[
                SystemPromptMessage(content=prompt),
            ],
            stop=[],
        )
        return summary.message.content
