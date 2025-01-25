from typing import Any, Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class GiteeAIToolEmbedding(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        headers = {
            "content-type": "application/json",
            "authorization": f"Bearer {self.runtime.credentials['api_key']}",
        }

        payload = {"inputs": tool_parameters.get("inputs")}
        model = tool_parameters.get("model", "bge-m3")
        url = f"https://ai.gitee.com/api/serverless/{model}/embeddings"
        response = requests.post(url, json=payload, headers=headers)
        if response.status_code != 200:
            return self.create_text_message(f"Got Error Response:{response.text}")

        return [self.create_text_message(response.content.decode("utf-8"))]
