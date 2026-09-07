from collections.abc import Generator
from typing import Any, override
import json
import httpx
from sqlalchemy.orm import Session

from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolInvokeError


class ExaGetContentsTool(BuiltinTool):
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
        urls_raw = tool_parameters.get("urls")
        if not urls_raw:
            yield self.create_text_message("Please provide at least one URL to fetch contents.")
            return

        urls: list[str] = []
        if isinstance(urls_raw, str):
            urls = [u.strip() for u in urls_raw.split(",") if u.strip()]
        elif isinstance(urls_raw, list):
            urls = urls_raw

        api_key = self.runtime.credentials.get("api_key")
        if not api_key:
            raise ToolInvokeError("Exa API key is missing. Please configure credentials in tool settings.")

        max_characters = int(tool_parameters.get("max_characters", 5000))
        include_highlights = bool(tool_parameters.get("include_highlights", False))

        payload: dict[str, Any] = {
            "urls": urls,
            "text": {"maxCharacters": max_characters},
        }
        if include_highlights:
            payload["highlights"] = {"numSentences": 3, "highlightsPerUrl": 3}

        try:
            with httpx.Client(timeout=30.0) as client:
                response = client.post(
                    "https://api.exa.ai/contents",
                    headers={"x-api-key": api_key, "Content-Type": "application/json"},
                    json=payload,
                )
                if response.status_code != 200:
                    raise ToolInvokeError(f"Exa contents error ({response.status_code}): {response.text}")
                data = response.json()

            results = data.get("results", [])
            yield self.create_json_message(data)

            output_blocks = []
            for item in results:
                url = item.get("url", "")
                title = item.get("title", "No Title")
                text = item.get("text", "")
                output_blocks.append(f"### [{title}]({url})\n{text}")

            yield self.create_text_message("\n\n".join(output_blocks))
        except Exception as e:
            if isinstance(e, ToolInvokeError):
                raise
            raise ToolInvokeError(f"Failed to fetch webpage contents from Exa: {str(e)}")
