from __future__ import annotations

from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from tools.acedata_client import (
    AceDataSeedreamClient,
    AceDataSeedreamError,
    parse_image_inputs,
)


class SeedreamEditImageTool(Tool):
    def _invoke(
        self, tool_parameters: dict[str, Any]
    ) -> Generator[ToolInvokeMessage, None, None]:
        prompt = tool_parameters.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError("`prompt` is required.")

        image_urls = parse_image_inputs(tool_parameters.get("image_urls"))
        if not image_urls:
            raise ValueError("`image_urls` must contain at least 1 item.")

        model = tool_parameters.get("model")
        model = model.strip() if isinstance(model, str) and model.strip() else None

        size = tool_parameters.get("size")
        size = size.strip() if isinstance(size, str) and size.strip() else None

        seed = tool_parameters.get("seed")
        if seed is not None and not isinstance(seed, int):
            raise ValueError("`seed` must be an integer.")

        sequential_image_generation = tool_parameters.get("sequential_image_generation")
        sequential_image_generation = (
            sequential_image_generation.strip()
            if isinstance(sequential_image_generation, str) and sequential_image_generation.strip()
            else None
        )

        stream = tool_parameters.get("stream")
        if stream is not None and not isinstance(stream, bool):
            raise ValueError("`stream` must be a boolean.")

        guidance_scale = tool_parameters.get("guidance_scale")
        if guidance_scale is not None and not isinstance(guidance_scale, (int, float)):
            raise ValueError("`guidance_scale` must be a number.")

        response_format = tool_parameters.get("response_format")
        response_format = (
            response_format.strip()
            if isinstance(response_format, str) and response_format.strip()
            else None
        )

        watermark = tool_parameters.get("watermark")
        if watermark is not None and not isinstance(watermark, bool):
            raise ValueError("`watermark` must be a boolean.")

        callback_url = tool_parameters.get("callback_url")
        callback_url = (
            callback_url.strip()
            if isinstance(callback_url, str) and callback_url.strip()
            else None
        )

        payload: dict[str, Any] = {"action": "edit", "prompt": prompt.strip(), "image": image_urls}
        if model:
            payload["model"] = model
        if size:
            payload["size"] = size
        if seed is not None:
            payload["seed"] = seed
        if sequential_image_generation:
            payload["sequential_image_generation"] = sequential_image_generation
        if stream is not None:
            payload["stream"] = stream
        if guidance_scale is not None:
            payload["guidance_scale"] = guidance_scale
        if response_format:
            payload["response_format"] = response_format
        if watermark is not None:
            payload["watermark"] = watermark
        if callback_url:
            payload["callback_url"] = callback_url

        client = AceDataSeedreamClient(
            bearer_token=str(self.runtime.credentials["acedata_bearer_token"])
        )
        try:
            result = client.generate_images(payload=payload, timeout_s=1800)
        except AceDataSeedreamError as e:
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

