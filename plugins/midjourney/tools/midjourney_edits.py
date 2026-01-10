from __future__ import annotations

from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from tools.acedata_client import (
    AceDataMidjourneyClient,
    AceDataMidjourneyError,
    build_midjourney_edits_payload,
)


class MidjourneyEditsTool(Tool):
    def _invoke(
        self, tool_parameters: dict[str, Any]
    ) -> Generator[ToolInvokeMessage, None, None]:
        payload = build_midjourney_edits_payload(tool_parameters)

        prompt = payload.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError("`prompt` is required.")

        image_url = payload.get("image_url")
        if not isinstance(image_url, str) or not image_url.strip():
            raise ValueError("`image_url` is required.")

        if "action" not in payload:
            payload["action"] = "generate"

        client = AceDataMidjourneyClient(
            bearer_token=str(self.runtime.credentials["acedata_bearer_token"])
        )

        try:
            result = client.edits(payload=payload, timeout_s=1800)
        except AceDataMidjourneyError as e:
            yield self.create_variable_message("success", False)
            yield self.create_variable_message("error", {"code": e.code, "message": e.message})
            yield self.create_variable_message("trace_id", e.trace_id)
            return

        output_image_url = result.get("image_url")
        if isinstance(output_image_url, str) and output_image_url.strip():
            yield self.create_image_message(output_image_url.strip())

        sub_image_urls = result.get("sub_image_urls")
        if isinstance(sub_image_urls, list):
            for item in sub_image_urls:
                if isinstance(item, str) and item.strip():
                    yield self.create_image_message(item.strip())

        yield self.create_variable_message("success", True if result.get("success") is not False else False)
        yield self.create_variable_message("task_id", result.get("task_id"))
        yield self.create_variable_message("trace_id", result.get("trace_id"))
        yield self.create_variable_message("data", result)
