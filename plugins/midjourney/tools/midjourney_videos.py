from __future__ import annotations

from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from tools.acedata_client import (
    AceDataMidjourneyClient,
    AceDataMidjourneyError,
    build_midjourney_videos_payload,
)


class MidjourneyVideosTool(Tool):
    def _invoke(
        self, tool_parameters: dict[str, Any]
    ) -> Generator[ToolInvokeMessage, None, None]:
        payload = build_midjourney_videos_payload(tool_parameters)

        action = payload.get("action") or "generate"
        prompt = payload.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError("`prompt` is required.")

        if action == "generate":
            image_url = payload.get("image_url")
            if not isinstance(image_url, str) or not image_url.strip():
                raise ValueError("`image_url` is required when action is generate.")
        elif action == "extend":
            video_id = payload.get("video_id")
            if not isinstance(video_id, str) or not video_id.strip():
                raise ValueError("`video_id` is required when action is extend.")
        else:
            raise ValueError("`action` must be generate or extend.")

        client = AceDataMidjourneyClient(
            bearer_token=str(self.runtime.credentials["acedata_bearer_token"])
        )

        try:
            mode = payload.get("mode")
            mode = mode.strip().lower() if isinstance(mode, str) else ""
            timeout_s = {"turbo": 600, "fast": 900, "relax": 1200}.get(mode or "fast", 900)
            result = client.videos(payload=payload, timeout_s=timeout_s)
        except AceDataMidjourneyError as e:
            yield self.create_variable_message("success", False)
            yield self.create_variable_message("error", {"code": e.code, "message": e.message})
            yield self.create_variable_message("trace_id", e.trace_id)
            return

        cover_image_url = result.get("image_url")
        if isinstance(cover_image_url, str) and cover_image_url.strip():
            yield self.create_image_message(cover_image_url.strip())

        yield self.create_variable_message("success", True if result.get("success") is not False else False)
        yield self.create_variable_message("task_id", result.get("task_id"))
        yield self.create_variable_message("trace_id", result.get("trace_id"))
        yield self.create_variable_message("data", result)
