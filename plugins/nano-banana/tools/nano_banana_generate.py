from __future__ import annotations

from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from tools.acedata_client import AceDataNanoBananaClient, AceDataNanoBananaError


class NanoBananaGenerateImageTool(Tool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage, None, None]:
        prompt = tool_parameters.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError("`prompt` is required.")

        model = tool_parameters.get("model")
        model = model.strip() if isinstance(model, str) and model.strip() else None

        aspect_ratio = tool_parameters.get("aspect_ratio")
        aspect_ratio = aspect_ratio.strip() if isinstance(aspect_ratio, str) and aspect_ratio.strip() else None

        resolution = tool_parameters.get("resolution")
        resolution = resolution.strip() if isinstance(resolution, str) and resolution.strip() else None

        client = AceDataNanoBananaClient(bearer_token=str(self.runtime.credentials["acedata_bearer_token"]))
        try:
            result = client.generate(
                prompt=prompt.strip(),
                model=model,
                aspect_ratio=aspect_ratio,
                resolution=resolution,
                timeout_s=1800,
            )
        except AceDataNanoBananaError as e:
            yield self.create_variable_message("success", False)
            yield self.create_variable_message("error", {"code": e.code, "message": e.message})
            yield self.create_variable_message("trace_id", e.trace_id)
            return

        for image_url in result.image_urls:
            yield self.create_image_message(image_url)

        yield self.create_variable_message("success", True)
        yield self.create_variable_message("task_id", result.task_id)
        yield self.create_variable_message("trace_id", result.trace_id)
        yield self.create_variable_message("data", result.data)
