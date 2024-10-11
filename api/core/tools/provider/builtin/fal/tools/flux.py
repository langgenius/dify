from typing import Any, Union

import fal_client

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool

FLUX_MODEL = {"schnell": "fal-ai/flux/schnell", "dev": "fal-ai/flux/dev", "pro": ""}


class FluxTool(BuiltinTool):
    """
    A tool for generating image via Fal.ai Flux model
    """

    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        api_key = self.runtime.credentials.get("fal_api_key", "")
        if not api_key:
            return self.create_text_message("Please input fal api key")
        client = fal_client.SyncClient(key=api_key)
        model = tool_parameters.get("model", "schnell")
        model_name = FLUX_MODEL.get(model)
        payload = {
            "prompt": tool_parameters.get("prompt"),
            "image_size": tool_parameters.get("image_size", "landscape_4_3"),
            "num_images": tool_parameters.get("num_images", 1),
            "seed": tool_parameters.get("seed"),
            "num_inference_steps": tool_parameters.get("num_inference_steps", 4),
            "sync_mode": tool_parameters.get("sync_mode", True),
            "enable_safety_checker": tool_parameters.get("enable_safety_checker", True),
        }
        handler = client.submit(model_name, arguments=payload)
        request_id = handler.request_id
        res = client.result(model_name, request_id)
        result = []
        for image in res.get("images", []):
            result.append(self.create_image_message(image=image.get("url"), save_as=self.VariableKey.IMAGE.value))
        return result
