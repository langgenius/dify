from collections.abc import Generator
from typing import Any, override

import httpx

from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolInvokeError


class DakeraStoreTool(BuiltinTool):
    """Persist a memory in a self-hosted Dakera server for future recall."""

    @override
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        credentials = self.runtime.credentials or {}
        api_url = credentials.get("api_url", "").rstrip("/")
        api_key = credentials.get("api_key", "")

        if not api_url:
            raise ToolInvokeError("Dakera server URL is not configured.")

        content = tool_parameters.get("content", "").strip()
        if not content:
            raise ToolInvokeError("Content is required.")

        agent_id = tool_parameters.get("agent_id") or "dify-agent"
        session_id = tool_parameters.get("session_id") or conversation_id or None
        tags_raw = tool_parameters.get("tags") or ""
        tags = [t.strip() for t in tags_raw.split(",") if t.strip()] if tags_raw else []

        headers: dict[str, str] = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        body: dict[str, Any] = {
            "content": content,
            "agent_id": agent_id,
        }
        if session_id:
            body["session_id"] = session_id
        if tags:
            body["tags"] = tags

        try:
            resp = httpx.post(
                f"{api_url}/v1/memory/store",
                headers=headers,
                json=body,
                timeout=10.0,
            )
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise ToolInvokeError(f"Dakera store failed: HTTP {exc.response.status_code}")
        except httpx.RequestError as exc:
            raise ToolInvokeError(f"Cannot reach Dakera server at {api_url}: {exc}")

        data = resp.json()
        memory = data.get("memory", {})
        memory_id = memory.get("id", "unknown")

        yield self.create_text_message(f"Memory stored successfully (id: {memory_id}).")
