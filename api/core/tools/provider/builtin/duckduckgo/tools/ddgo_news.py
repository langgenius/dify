from typing import Any

from duckduckgo_search import DDGS

from core.model_runtime.entities.message_entities import SystemPromptMessage
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool

SUMMARY_PROMPT = """
User's query:
{query}

Here are the news results:
{content}

Please summarize the news in a few sentences.
"""


class DuckDuckGoNewsSearchTool(BuiltinTool):
    """
    Tool for performing a news search using DuckDuckGo search engine.
    """

    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage | list[ToolInvokeMessage]:
        query_dict = {
            "keywords": tool_parameters.get("query"),
            "timelimit": tool_parameters.get("timelimit"),
            "max_results": tool_parameters.get("max_results"),
            "safesearch": "moderate",
            "region": "wt-wt",
        }

        # Add query_prefix handling
        query_prefix = tool_parameters.get("query_prefix", "").strip()
        final_query = f"{query_prefix} {query_dict['keywords']}".strip()
        query_dict["keywords"] = final_query

        try:
            response = list(DDGS().news(**query_dict))
            if not response:
                return [self.create_text_message("No news found matching your criteria.")]
        except Exception as e:
            return [self.create_text_message(f"Error searching news: {str(e)}")]

        require_summary = tool_parameters.get("require_summary", False)

        if require_summary:
            results = "\n".join([f"{res.get('title')}: {res.get('body')}" for res in response])
            results = self.summary_results(user_id=user_id, content=results, query=query_dict["keywords"])
            return self.create_text_message(text=results)

        # Create rich markdown content for each news item
        markdown_result = "\n\n"
        json_result = []

        for res in response:
            markdown_result += f"### {res.get('title', 'Untitled')}\n\n"
            if res.get("date"):
                markdown_result += f"**Date:** {res.get('date')}\n\n"
            if res.get("body"):
                markdown_result += f"{res.get('body')}\n\n"
            if res.get("source"):
                markdown_result += f"*Source: {res.get('source')}*\n\n"
            if res.get("image"):
                markdown_result += f"![{res.get('title', '')}]({res.get('image')})\n\n"
            markdown_result += f"[Read more]({res.get('url', '')})\n\n---\n\n"

            json_result.append(
                self.create_json_message(
                    {
                        "title": res.get("title", ""),
                        "date": res.get("date", ""),
                        "body": res.get("body", ""),
                        "url": res.get("url", ""),
                        "image": res.get("image", ""),
                        "source": res.get("source", ""),
                    }
                )
            )

        return [self.create_text_message(markdown_result)] + json_result

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
