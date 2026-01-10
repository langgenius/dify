from __future__ import annotations

from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from tools.acedata_client import (
    AceDataSeedanceClient,
    AceDataSeedanceError,
    parse_image_urls,
)


class SeedanceGenerateVideoTool(Tool):
    def _invoke(
        self, tool_parameters: dict[str, Any]
    ) -> Generator[ToolInvokeMessage, None, None]:
        prompt = tool_parameters.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError("`prompt` is required.")

        model = tool_parameters.get("model")
        model = model.strip() if isinstance(model, str) and model.strip() else None

        first_frame_url = tool_parameters.get("first_frame_url")
        first_frame_url = (
            first_frame_url.strip()
            if isinstance(first_frame_url, str) and first_frame_url.strip()
            else None
        )

        last_frame_url = tool_parameters.get("last_frame_url")
        last_frame_url = (
            last_frame_url.strip()
            if isinstance(last_frame_url, str) and last_frame_url.strip()
            else None
        )

        reference_image_urls = parse_image_urls(
            tool_parameters.get("reference_image_urls"),
            field_name="reference_image_urls",
        )

        return_last_frame = tool_parameters.get("return_last_frame")
        if return_last_frame is not None and not isinstance(return_last_frame, bool):
            raise ValueError("`return_last_frame` must be a boolean.")

        service_tier = tool_parameters.get("service_tier")
        service_tier = (
            service_tier.strip()
            if isinstance(service_tier, str) and service_tier.strip()
            else None
        )

        execution_expires_after = tool_parameters.get("execution_expires_after")
        if execution_expires_after is not None:
            if isinstance(execution_expires_after, bool) or not isinstance(
                execution_expires_after, int
            ):
                raise ValueError("`execution_expires_after` must be an integer.")

        callback_url = tool_parameters.get("callback_url")
        callback_url = (
            callback_url.strip()
            if isinstance(callback_url, str) and callback_url.strip()
            else None
        )

        client = AceDataSeedanceClient(
            bearer_token=str(self.runtime.credentials["acedata_bearer_token"])
        )
        try:
            result = client.generate_video(
                model=model,
                prompt=prompt.strip(),
                first_frame_url=first_frame_url,
                last_frame_url=last_frame_url,
                reference_image_urls=reference_image_urls or None,
                return_last_frame=return_last_frame,
                service_tier=service_tier,
                execution_expires_after=execution_expires_after,
                callback_url=callback_url,
                timeout_s=600,
            )
        except AceDataSeedanceError as e:
            yield self.create_variable_message("success", False)
            yield self.create_variable_message("error", {"code": e.code, "message": e.message})
            yield self.create_variable_message("trace_id", e.trace_id)
            return

        yield self.create_variable_message("success", True)
        yield self.create_variable_message("task_id", result.task_id)
        yield self.create_variable_message("trace_id", result.trace_id)
        yield self.create_variable_message("data", result.data)
