from collections.abc import Generator
from typing import Any, override

from core.helper import ssrf_proxy
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolInvokeError, ToolProviderCredentialValidationError

DEFAULT_BASE_URL = "https://api.twelvelabs.io/v1.3"


class TwelveLabsAnalyzeTool(BuiltinTool):
    @override
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        api_key = self.runtime.credentials.get("api_key") if self.runtime else None
        if not api_key:
            raise ToolProviderCredentialValidationError("TwelveLabs API key is required.")
        base_url = (self.runtime.credentials.get("base_url") or DEFAULT_BASE_URL).rstrip("/")

        video_id = tool_parameters.get("video_id")
        prompt = tool_parameters.get("prompt")
        if not video_id:
            yield self.create_text_message("Please provide a TwelveLabs video_id.")
            return
        if not prompt:
            yield self.create_text_message("Please provide a prompt.")
            return

        payload: dict[str, Any] = {
            "video_id": video_id,
            "prompt": prompt,
            "stream": False,
        }
        if tool_parameters.get("temperature") is not None:
            payload["temperature"] = tool_parameters["temperature"]
        if tool_parameters.get("max_tokens") is not None:
            payload["max_tokens"] = tool_parameters["max_tokens"]

        try:
            response = ssrf_proxy.post(
                f"{base_url}/analyze",
                headers={"x-api-key": api_key, "Content-Type": "application/json"},
                json=payload,
                timeout=(10, 300),
            )
        except Exception as e:
            raise ToolInvokeError(f"Failed to reach TwelveLabs API: {e}")

        if response.status_code >= 400:
            raise ToolInvokeError(f"TwelveLabs analyze failed ({response.status_code}): {response.text}")

        try:
            result = response.json()
        except ValueError as e:
            raise ToolInvokeError(f"TwelveLabs returned an invalid response: {e}")

        text = result.get("data", "")
        yield self.create_text_message(text)
        yield self.create_json_message(result)
