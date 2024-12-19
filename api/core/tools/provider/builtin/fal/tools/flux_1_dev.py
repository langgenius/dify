from typing import Any, Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class Flux1DevTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        headers = {
            "Authorization": f"Key {self.runtime.credentials['fal_api_key']}",
            "Content-Type": "application/json",
        }

        prompt = tool_parameters.get("prompt", "")
        sanitized_prompt = prompt.replace("\\", "")  # Remove backslashes from the prompt which may cause errors

        payload = {
            "prompt": sanitized_prompt,
            "image_size": tool_parameters.get("image_size", "landscape_4_3"),
            "num_inference_steps": tool_parameters.get("num_inference_steps", 28),
            "guidance_scale": tool_parameters.get("guidance_scale", 3.5),
            "seed": tool_parameters.get("seed"),
            "num_images": tool_parameters.get("num_images", 1),
            "enable_safety_checker": tool_parameters.get("enable_safety_checker", True),
            "sync_mode": tool_parameters.get("sync_mode", False),
        }

        url = "https://fal.run/fal-ai/flux/dev"

        response = requests.post(url, json=payload, headers=headers)

        if response.status_code != 200:
            return self.create_text_message(f"Got Error Response: {response.text}")

        res = response.json()
        result = [self.create_json_message(res)]

        for image_info in res.get("images", []):
            image_url = image_info.get("url")
            if image_url:
                result.append(self.create_image_message(image=image_url, save_as=self.VariableKey.IMAGE.value))

        return result
