from __future__ import annotations

from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from tools.acedata_client import AceDataFluxClient, AceDataFluxError


class FluxEditImageTool(Tool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage, None, None]:
        prompt = tool_parameters.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError("`prompt` is required.")

        image_url = tool_parameters.get("image_url")
        if not isinstance(image_url, str) or not image_url.strip():
            raise ValueError("`image_url` is required.")

        model = tool_parameters.get("model")
        model = model.strip() if isinstance(model, str) and model.strip() else None

        size = tool_parameters.get("size")
        size = size.strip() if isinstance(size, str) and size.strip() else None

        callback_url = tool_parameters.get("callback_url")
        callback_url = (
            callback_url.strip() if isinstance(callback_url, str) and callback_url.strip() else None
        )

        client = AceDataFluxClient(bearer_token=str(self.runtime.credentials["acedata_bearer_token"]))
        try:
            result = client.edit(
                prompt=prompt.strip(),
                image_url=image_url.strip(),
                model=model,
                size=size,
                callback_url=callback_url,
                timeout_s=1800,
            )
        except AceDataFluxError as e:
            yield self.create_variable_message("success", False)
            yield self.create_variable_message("error", {"code": e.code, "message": e.message})
            yield self.create_variable_message("trace_id", e.trace_id)
            return

        for out_url in result.image_urls:
            yield self.create_image_message(out_url)

        yield self.create_variable_message("success", True)
        yield self.create_variable_message("task_id", result.task_id)
        yield self.create_variable_message("trace_id", result.trace_id)
        yield self.create_variable_message("data", result.data)

