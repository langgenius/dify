from __future__ import annotations

from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from tools.acedata_client import AceDataVeoClient, AceDataVeoError, parse_image_urls


class VeoGenerateVideoTool(Tool):
    def _invoke(
        self, tool_parameters: dict[str, Any]
    ) -> Generator[ToolInvokeMessage, None, None]:
        action = tool_parameters.get("action")
        if not isinstance(action, str) or not action.strip():
            raise ValueError("`action` is required.")
        action = action.strip()

        model = tool_parameters.get("model")
        model = model.strip() if isinstance(model, str) and model.strip() else None

        prompt = tool_parameters.get("prompt")
        prompt = prompt.strip() if isinstance(prompt, str) and prompt.strip() else None

        image_urls = parse_image_urls(tool_parameters.get("image_urls"))

        video_id = tool_parameters.get("video_id")
        video_id = video_id.strip() if isinstance(video_id, str) and video_id.strip() else None

        aspect_ratio = tool_parameters.get("aspect_ratio")
        aspect_ratio = (
            aspect_ratio.strip()
            if isinstance(aspect_ratio, str) and aspect_ratio.strip()
            else None
        )

        translation = tool_parameters.get("translation")
        if translation is not None and not isinstance(translation, bool):
            raise ValueError("`translation` must be a boolean.")

        callback_url = tool_parameters.get("callback_url")
        callback_url = (
            callback_url.strip()
            if isinstance(callback_url, str) and callback_url.strip()
            else None
        )

        if action in {"text2video", "image2video"}:
            if not prompt:
                raise ValueError("`prompt` is required when action is text2video/image2video.")

        if action == "image2video" and not image_urls:
            raise ValueError("`image_urls` must contain at least 1 item when action is image2video.")

        if action == "get1080p" and not video_id:
            raise ValueError("`video_id` is required when action is get1080p.")

        client = AceDataVeoClient(
            bearer_token=str(self.runtime.credentials["acedata_bearer_token"])
        )
        try:
            result = client.generate_video(
                action=action,
                model=model,
                prompt=prompt,
                image_urls=image_urls or None,
                video_id=video_id,
                aspect_ratio=aspect_ratio,
                translation=translation,
                callback_url=callback_url,
                timeout_s=1800,
            )
        except AceDataVeoError as e:
            yield self.create_variable_message("success", False)
            yield self.create_variable_message("error", {"code": e.code, "message": e.message})
            yield self.create_variable_message("trace_id", e.trace_id)
            return

        yield self.create_variable_message("success", True)
        yield self.create_variable_message("task_id", result.task_id)
        yield self.create_variable_message("trace_id", result.trace_id)
        yield self.create_variable_message("data", result.data)
