from __future__ import annotations

from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from tools.acedata_client import AceDataLumaClient, AceDataLumaError


class LumaGenerateVideoTool(Tool):
    def _invoke(
        self, tool_parameters: dict[str, Any]
    ) -> Generator[ToolInvokeMessage, None, None]:
        action = tool_parameters.get("action")
        if not isinstance(action, str) or not action.strip():
            raise ValueError("`action` is required.")
        action = action.strip()

        if action not in {"generate", "extend"}:
            raise ValueError("`action` must be one of: generate, extend.")

        prompt = tool_parameters.get("prompt")
        prompt = prompt.strip() if isinstance(prompt, str) and prompt.strip() else None

        aspect_ratio = tool_parameters.get("aspect_ratio")
        aspect_ratio = (
            aspect_ratio.strip()
            if isinstance(aspect_ratio, str) and aspect_ratio.strip()
            else None
        )

        start_image_url = tool_parameters.get("start_image_url")
        start_image_url = (
            start_image_url.strip()
            if isinstance(start_image_url, str) and start_image_url.strip()
            else None
        )

        end_image_url = tool_parameters.get("end_image_url")
        end_image_url = (
            end_image_url.strip()
            if isinstance(end_image_url, str) and end_image_url.strip()
            else None
        )

        video_url = tool_parameters.get("video_url")
        video_url = video_url.strip() if isinstance(video_url, str) and video_url.strip() else None

        video_id = tool_parameters.get("video_id")
        video_id = video_id.strip() if isinstance(video_id, str) and video_id.strip() else None

        enhancement = tool_parameters.get("enhancement")
        if enhancement is not None and not isinstance(enhancement, bool):
            raise ValueError("`enhancement` must be a boolean.")

        loop = tool_parameters.get("loop")
        if loop is not None and not isinstance(loop, bool):
            raise ValueError("`loop` must be a boolean.")

        timeout = tool_parameters.get("timeout")
        if timeout is not None and not isinstance(timeout, (int, float)):
            raise ValueError("`timeout` must be a number (seconds).")

        callback_url = tool_parameters.get("callback_url")
        callback_url = (
            callback_url.strip()
            if isinstance(callback_url, str) and callback_url.strip()
            else None
        )

        if action == "generate" and not prompt:
            raise ValueError("`prompt` is required when action is generate.")

        if action == "extend" and not (video_id or video_url):
            raise ValueError("`video_id` or `video_url` is required when action is extend.")

        client = AceDataLumaClient(
            bearer_token=str(self.runtime.credentials["acedata_bearer_token"])
        )
        try:
            result = client.generate_video(
                action=action,
                prompt=prompt,
                aspect_ratio=aspect_ratio,
                start_image_url=start_image_url,
                end_image_url=end_image_url,
                video_url=video_url,
                video_id=video_id,
                enhancement=enhancement,
                loop=loop,
                timeout=timeout,
                callback_url=callback_url,
                timeout_s=1800,
            )
        except AceDataLumaError as e:
            yield self.create_variable_message("success", False)
            yield self.create_variable_message("error", {"code": e.code, "message": e.message})
            yield self.create_variable_message("trace_id", e.trace_id)
            return

        yield self.create_variable_message("success", True)
        if isinstance(result.get("task_id"), str):
            yield self.create_variable_message("task_id", result.get("task_id"))
        if isinstance(result.get("trace_id"), str):
            yield self.create_variable_message("trace_id", result.get("trace_id"))
        yield self.create_variable_message("data", result)
