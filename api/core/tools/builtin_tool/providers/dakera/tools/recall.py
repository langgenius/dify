from collections.abc import Generator
from typing import Any, override

import httpx

from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolInvokeError


class DakeraRecallTool(BuiltinTool):
    """Recall semantically relevant memories from a self-hosted Dakera server."""

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

        query = tool_parameters.get("query", "").strip()
        if not query:
            raise ToolInvokeError("Query is required.")

        agent_id = tool_parameters.get("agent_id") or "dify-agent"
        session_id = tool_parameters.get("session_id") or None
        top_k = int(tool_parameters.get("top_k") or 5)
        top_k = max(1, min(20, top_k))

        headers: dict[str, str] = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        body: dict[str, Any] = {
            "agent_id": agent_id,
            "query": query,
            "top_k": top_k,
        }
        if session_id:
            body["session_id"] = session_id

        try:
            resp = httpx.post(
                f"{api_url}/v1/memory/search",
                headers=headers,
                json=body,
                timeout=10.0,
            )
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise ToolInvokeError(f"Dakera recall failed: HTTP {exc.response.status_code}")
        except httpx.RequestError as exc:
            raise ToolInvokeError(f"Cannot reach Dakera server at {api_url}: {exc}")

        data = resp.json()
        memories: list[dict[str, Any]] = data.get("memories", [])

        if not memories:
            yield self.create_text_message("No relevant memories found.")
            return

        lines: list[str] = [f"Found {len(memories)} relevant {'memory' if len(memories) == 1 else 'memories'}:\n"]
        for i, item in enumerate(memories, 1):
            mem = item.get("memory", {})
            score = item.get("score", 0.0)
            content = mem.get("content", "")
            lines.append(f"{i}. [{score:.3f}] {content}")

        yield self.create_text_message("\n".join(lines))
