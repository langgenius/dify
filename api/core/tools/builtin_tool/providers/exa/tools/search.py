from collections.abc import Generator
from typing import Any, override
import json
import httpx
from sqlalchemy.orm import Session

from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolInvokeError


class ExaSearchTool(BuiltinTool):
    @override
    def _invoke(
        self,
        session: Session,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        query = tool_parameters.get("query", "").strip()
        if not query:
            yield self.create_text_message("Please provide a search query.")
            return

        api_key = self.runtime.credentials.get("api_key")
        if not api_key:
            raise ToolInvokeError("Exa API key is missing. Please configure credentials in tool settings.")

        num_results = int(tool_parameters.get("num_results", 5))
        search_type = tool_parameters.get("search_type", "neural")
        use_autoprompt = tool_parameters.get("use_autoprompt", True)
        include_text = tool_parameters.get("include_text", True)
        include_highlights = tool_parameters.get("include_highlights", False)

        payload: dict[str, Any] = {
            "query": query,
            "type": search_type,
            "numResults": min(max(num_results, 1), 25),
            "useAutoprompt": bool(use_autoprompt),
        }

        contents_payload: dict[str, Any] = {}
        if include_text:
            contents_payload["text"] = {"maxCharacters": 3000}
        if include_highlights:
            contents_payload["highlights"] = {"numSentences": 3, "highlightsPerUrl": 2}

        if contents_payload:
            payload["contents"] = contents_payload

        include_domains = tool_parameters.get("include_domains")
        if include_domains:
            if isinstance(include_domains, str):
                payload["includeDomains"] = [d.strip() for d in include_domains.split(",") if d.strip()]
            elif isinstance(include_domains, list):
                payload["includeDomains"] = include_domains

        exclude_domains = tool_parameters.get("exclude_domains")
        if exclude_domains:
            if isinstance(exclude_domains, str):
                payload["excludeDomains"] = [d.strip() for d in exclude_domains.split(",") if d.strip()]
            elif isinstance(exclude_domains, list):
                payload["excludeDomains"] = exclude_domains

        try:
            with httpx.Client(timeout=30.0) as client:
                response = client.post(
                    "https://api.exa.ai/search",
                    headers={"x-api-key": api_key, "Content-Type": "application/json"},
                    json=payload,
                )
                if response.status_code != 200:
                    raise ToolInvokeError(f"Exa search error ({response.status_code}): {response.text}")
                data = response.json()

            results = data.get("results", [])
            yield self.create_json_message(data)
            
            summary_lines = [f"Found {len(results)} results for query: '{query}'\n"]
            for idx, item in enumerate(results, 1):
                title = item.get("title", "No Title")
                url = item.get("url", "")
                author = item.get("author") or "Unknown"
                published = item.get("publishedDate") or "Unknown"
                text = item.get("text", "")
                summary_lines.append(f"{idx}. [{title}]({url}) (Author: {author}, Date: {published})")
                if text:
                    summary_lines.append(f"   {text[:200]}...")
            
            yield self.create_text_message("\n".join(summary_lines))
        except Exception as e:
            if isinstance(e, ToolInvokeError):
                raise
            raise ToolInvokeError(f"Failed to execute Exa search: {str(e)}")
