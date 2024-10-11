from typing import Any, Union

import fal_client

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class AuraFlowTool(BuiltinTool):
    """
    A tool for generating image via Fal.ai AuraFlow model
    """

    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        api_key = self.runtime.credentials.get("fal_api_key", "")
        if not api_key:
            return self.create_text_message("Please input fal api key")
        client = fal_client.SyncClient(key=api_key)
        payload = {
            "prompt": tool_parameters.get("prompt"),
            "negative_prompt": tool_parameters.get("negative_prompt", ""),
            "image_size": tool_parameters.get("image_size", "square_hd"),
            "num_images": tool_parameters.get("num_images", 1),
            "seed": tool_parameters.get("seed"),
            "guidance_scale": tool_parameters.get("guidance_scale", 5),
            "num_inference_steps": tool_parameters.get("num_inference_steps", 50),
            "sync_mode": tool_parameters.get("sync_mode", True),
            "enable_safety_checker": tool_parameters.get("enable_safety_checker", True),
        }
        handler = client.submit("fal-ai/kolors", arguments=payload)
        request_id = handler.request_id
        res = client.result("fal-ai/kolors", request_id)
        result = []
        for image in res.get("images", []):
            result.append(self.create_image_message(image=image.get("url"), save_as=self.VariableKey.IMAGE.value))
        return result
