from typing import Any, Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool

FLUX_URL = {
    "schnell": "https://api.siliconflow.cn/v1/black-forest-labs/FLUX.1-schnell/text-to-image",
    "dev": "https://api.siliconflow.cn/v1/image/generations",
}


class FluxTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        headers = {
            "accept": "application/json",
            "content-type": "application/json",
            "authorization": f"Bearer {self.runtime.credentials['siliconFlow_api_key']}",
        }

        payload = {
            "prompt": tool_parameters.get("prompt"),
            "image_size": tool_parameters.get("image_size", "1024x1024"),
            "seed": tool_parameters.get("seed"),
            "num_inference_steps": tool_parameters.get("num_inference_steps", 20),
        }
        model = tool_parameters.get("model", "schnell")
        url = FLUX_URL.get(model)
        if model == "dev":
            payload["model"] = "black-forest-labs/FLUX.1-dev"

        response = requests.post(url, json=payload, headers=headers)
        if response.status_code != 200:
            return self.create_text_message(f"Got Error Response:{response.text}")

        res = response.json()
        result = [self.create_json_message(res)]
        for image in res.get("images", []):
            result.append(self.create_image_message(image=image.get("url"), save_as=self.VariableKey.IMAGE.value))
        return result
