from __future__ import annotations

from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from tools.acedata_client import AceDataSoraClient, AceDataSoraError, parse_image_urls


class SoraGenerateVideoTool(Tool):
    def _invoke(
        self, tool_parameters: dict[str, Any]
    ) -> Generator[ToolInvokeMessage, None, None]:
        prompt = tool_parameters.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError("`prompt` is required.")

        model = tool_parameters.get("model")
        if not isinstance(model, str) or not model.strip():
            raise ValueError("`model` is required.")

        duration = tool_parameters.get("duration")
        if isinstance(duration, str) and duration.strip().isdigit():
            duration = int(duration.strip())
        if duration is not None and not isinstance(duration, int):
            raise ValueError("`duration` must be an integer.")

        size = tool_parameters.get("size")
        size = size.strip() if isinstance(size, str) and size.strip() else None

        orientation = tool_parameters.get("orientation")
        orientation = (
            orientation.strip()
            if isinstance(orientation, str) and orientation.strip()
            else None
        )

        image_urls = parse_image_urls(tool_parameters.get("image_urls"))

        character_url = tool_parameters.get("character_url")
        character_url = (
            character_url.strip()
            if isinstance(character_url, str) and character_url.strip()
            else None
        )

        character_start = tool_parameters.get("character_start")
        if character_start is not None and not isinstance(character_start, (int, float)):
            raise ValueError("`character_start` must be a number.")

        character_end = tool_parameters.get("character_end")
        if character_end is not None and not isinstance(character_end, (int, float)):
            raise ValueError("`character_end` must be a number.")

        callback_url = tool_parameters.get("callback_url")
        callback_url = (
            callback_url.strip()
            if isinstance(callback_url, str) and callback_url.strip()
            else None
        )

        client = AceDataSoraClient(
            bearer_token=str(self.runtime.credentials["acedata_bearer_token"])
        )
        try:
            result = client.generate_video(
                prompt=prompt.strip(),
                model=model.strip(),
                duration=duration,
                size=size,
                orientation=orientation,
                image_urls=image_urls or None,
                character_url=character_url,
                character_start=float(character_start) if character_start is not None else None,
                character_end=float(character_end) if character_end is not None else None,
                callback_url=callback_url,
                timeout_s=1800,
            )
        except AceDataSoraError as e:
            yield self.create_variable_message("success", False)
            yield self.create_variable_message("error", {"code": e.code, "message": e.message})
            yield self.create_variable_message("trace_id", e.trace_id)
            return

        yield self.create_variable_message("success", True)
        yield self.create_variable_message("task_id", result.task_id)
        yield self.create_variable_message("trace_id", result.trace_id)
        yield self.create_variable_message("data", result.data)
