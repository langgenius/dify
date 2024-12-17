from typing import Any, Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class Flux11ProTool(BuiltinTool):
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
            "seed": tool_parameters.get("seed"),
            "sync_mode": tool_parameters.get("sync_mode", False),
            "num_images": tool_parameters.get("num_images", 1),
            "enable_safety_checker": tool_parameters.get("enable_safety_checker", True),
            "safety_tolerance": tool_parameters.get("safety_tolerance", "2"),
        }

        url = "https://fal.run/fal-ai/flux-pro/v1.1"

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
