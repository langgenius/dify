from typing import Any, Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class GiteeAIToolText2Image(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        headers = {
            "content-type": "application/json",
            "authorization": f"Bearer {self.runtime.credentials['api_key']}",
        }

        payload = {
            "inputs": tool_parameters.get("inputs"),
            "width": tool_parameters.get("width", "720"),
            "height": tool_parameters.get("height", "720"),
        }
        model = tool_parameters.get("model", "Kolors")
        url = f"https://ai.gitee.com/api/serverless/{model}/text-to-image"

        response = requests.post(url, json=payload, headers=headers)
        if response.status_code != 200:
            return self.create_text_message(f"Got Error Response:{response.text}")

        # The returned image is base64 and needs to be mark as an image
        result = [self.create_blob_message(blob=response.content, meta={"mime_type": "image/jpeg"})]

        return result
