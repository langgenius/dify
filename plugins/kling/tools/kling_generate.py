from __future__ import annotations

from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from tools.acedata_client import (
    AceDataKlingClient,
    AceDataKlingError,
    parse_camera_control,
)


class KlingGenerateVideoTool(Tool):
    def _invoke(
        self, tool_parameters: dict[str, Any]
    ) -> Generator[ToolInvokeMessage, None, None]:
        action = tool_parameters.get("action")
        if not isinstance(action, str) or not action.strip():
            raise ValueError("`action` is required.")
        action = action.strip()

        model = tool_parameters.get("model")
        model = model.strip() if isinstance(model, str) and model.strip() else None

        mode = tool_parameters.get("mode")
        mode = mode.strip() if isinstance(mode, str) and mode.strip() else None

        prompt = tool_parameters.get("prompt")
        prompt = prompt.strip() if isinstance(prompt, str) and prompt.strip() else None

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

        negative_prompt = tool_parameters.get("negative_prompt")
        negative_prompt = (
            negative_prompt.strip()
            if isinstance(negative_prompt, str) and negative_prompt.strip()
            else None
        )

        aspect_ratio = tool_parameters.get("aspect_ratio")
        aspect_ratio = (
            aspect_ratio.strip()
            if isinstance(aspect_ratio, str) and aspect_ratio.strip()
            else None
        )

        duration = tool_parameters.get("duration")
        if duration is not None:
            if isinstance(duration, bool) or not isinstance(duration, (int, float)):
                raise ValueError("`duration` must be a number.")
            duration = int(duration)

        cfg_scale = tool_parameters.get("cfg_scale")
        if cfg_scale is not None:
            if isinstance(cfg_scale, bool) or not isinstance(cfg_scale, (int, float)):
                raise ValueError("`cfg_scale` must be a number.")
            cfg_scale = float(cfg_scale)

        camera_control = parse_camera_control(tool_parameters.get("camera_control"))

        callback_url = tool_parameters.get("callback_url")
        callback_url = (
            callback_url.strip()
            if isinstance(callback_url, str) and callback_url.strip()
            else None
        )

        video_id = tool_parameters.get("video_id")
        video_id = video_id.strip() if isinstance(video_id, str) and video_id.strip() else None

        mirror = tool_parameters.get("mirror")
        if mirror is not None and not isinstance(mirror, bool):
            raise ValueError("`mirror` must be a boolean.")

        if action in {"text2video", "image2video", "extend"} and not prompt:
            raise ValueError("`prompt` is required when action is text2video/image2video/extend.")
        if action == "image2video" and not start_image_url:
            raise ValueError("`start_image_url` is required when action is image2video.")
        if action == "extend" and not video_id:
            raise ValueError("`video_id` is required when action is extend.")

        client = AceDataKlingClient(
            bearer_token=str(self.runtime.credentials["acedata_bearer_token"])
        )
        try:
            result = client.generate_video(
                action=action,
                model=model,
                mode=mode,
                prompt=prompt,
                start_image_url=start_image_url,
                end_image_url=end_image_url,
                negative_prompt=negative_prompt,
                aspect_ratio=aspect_ratio,
                duration=duration,
                camera_control=camera_control,
                cfg_scale=cfg_scale,
                callback_url=callback_url,
                video_id=video_id,
                mirror=mirror,
                timeout_s=1800,
            )
        except AceDataKlingError as e:
            yield self.create_variable_message("success", False)
            yield self.create_variable_message(
                "error", {"code": e.code, "message": e.message}
            )
            yield self.create_variable_message("trace_id", e.trace_id)
            return

        yield self.create_variable_message("success", True)
        yield self.create_variable_message("task_id", result.task_id)
        yield self.create_variable_message("trace_id", result.trace_id)
        yield self.create_variable_message("data", result.data)
