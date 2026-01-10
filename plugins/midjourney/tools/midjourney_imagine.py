from __future__ import annotations

from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from tools.acedata_client import (
    AceDataMidjourneyClient,
    AceDataMidjourneyError,
    build_midjourney_imagine_payload,
)


class MidjourneyImagineTool(Tool):
    def _invoke(
        self, tool_parameters: dict[str, Any]
    ) -> Generator[ToolInvokeMessage, None, None]:
        payload = build_midjourney_imagine_payload(tool_parameters)

        action = payload.get("action") or "generate"
        prompt = payload.get("prompt")
        image_id = payload.get("image_id")

        if action == "generate":
            if not isinstance(prompt, str) or not prompt.strip():
                raise ValueError("`prompt` is required when action is generate.")
        else:
            if not isinstance(image_id, str) or not image_id.strip():
                raise ValueError("`image_id` is required when action is not generate.")

        client = AceDataMidjourneyClient(
            bearer_token=str(self.runtime.credentials["acedata_bearer_token"])
        )

        try:
            result = client.imagine(payload=payload, timeout_s=1800)
        except AceDataMidjourneyError as e:
            yield self.create_variable_message("success", False)
            yield self.create_variable_message("error", {"code": e.code, "message": e.message})
            yield self.create_variable_message("trace_id", e.trace_id)
            return

        image_url = result.get("image_url")
        if isinstance(image_url, str) and image_url.strip():
            yield self.create_image_message(image_url.strip())

        yield self.create_variable_message("success", True if result.get("success") is not False else False)
        yield self.create_variable_message("task_id", result.get("task_id"))
        yield self.create_variable_message("trace_id", result.get("trace_id"))
        yield self.create_variable_message("data", result)
