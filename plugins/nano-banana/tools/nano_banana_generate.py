from __future__ import annotations

from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from tools.acedata_client import AceDataNanoBananaClient


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

        callback_url = tool_parameters.get("callback_url")
        callback_url = callback_url.strip() if isinstance(callback_url, str) and callback_url.strip() else None

        client = AceDataNanoBananaClient(bearer_token=str(self.runtime.credentials["acedata_bearer_token"]))
        result = client.generate(
            prompt=prompt.strip(),
            model=model,
            aspect_ratio=aspect_ratio,
            resolution=resolution,
            callback_url=callback_url,
            timeout_s=120,
        )

        for image_url in result.image_urls:
            yield self.create_image_message(image_url)

        yield self.create_json_message(
            {
                "success": True,
                "action": "generate",
                "task_id": result.task_id,
                "trace_id": result.trace_id,
                "data": result.data,
                "image_urls": result.image_urls,
            }
        )

