from __future__ import annotations

from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from tools.acedata_client import AceDataHailuoClient, AceDataHailuoError


class HailuoGenerateVideoTool(Tool):
    def _invoke(
        self, tool_parameters: dict[str, Any]
    ) -> Generator[ToolInvokeMessage, None, None]:
        action = tool_parameters.get("action")
        if not isinstance(action, str) or not action.strip():
            raise ValueError("`action` is required.")
        action = action.strip()

        if action != "generate":
            raise ValueError("`action` must be generate.")

        prompt = tool_parameters.get("prompt")
        prompt = prompt.strip() if isinstance(prompt, str) and prompt.strip() else None
        if not prompt:
            raise ValueError("`prompt` is required.")

        model = tool_parameters.get("model")
        model = model.strip() if isinstance(model, str) and model.strip() else None

        first_image_url = tool_parameters.get("first_image_url")
        first_image_url = (
            first_image_url.strip()
            if isinstance(first_image_url, str) and first_image_url.strip()
            else None
        )

        callback_url = tool_parameters.get("callback_url")
        callback_url = (
            callback_url.strip()
            if isinstance(callback_url, str) and callback_url.strip()
            else None
        )

        mirror = tool_parameters.get("mirror")
        if mirror is not None and not isinstance(mirror, bool):
            raise ValueError("`mirror` must be a boolean.")

        if model == "minimax-i2v" and not first_image_url:
            raise ValueError("`first_image_url` is required when model is minimax-i2v.")

        client = AceDataHailuoClient(
            bearer_token=str(self.runtime.credentials["acedata_bearer_token"])
        )
        try:
            result = client.generate_video(
                action=action,
                prompt=prompt,
                model=model,
                first_image_url=first_image_url,
                callback_url=callback_url,
                mirror=mirror,
                timeout_s=1800,
            )
        except AceDataHailuoError as e:
            yield self.create_variable_message("success", False)
            yield self.create_variable_message("error", {"code": e.code, "message": e.message})
            yield self.create_variable_message("trace_id", e.trace_id)
            return

        yield self.create_variable_message("success", True)
        yield self.create_variable_message("task_id", result.task_id)
        yield self.create_variable_message("trace_id", result.trace_id)
        yield self.create_variable_message("data", result.data)
