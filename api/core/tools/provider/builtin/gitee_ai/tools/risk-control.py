from typing import Any, Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class GiteeAIToolRiskControl(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        headers = {
            "content-type": "application/json",
            "authorization": f"Bearer {self.runtime.credentials['api_key']}",
        }

        inputs = [{"type": "text", "text": tool_parameters.get("input-text")}]
        model = tool_parameters.get("model", "Security-semantic-filtering")
        payload = {"model": model, "input": inputs}
        url = "https://ai.gitee.com/v1/moderations"
        response = requests.post(url, json=payload, headers=headers)
        if response.status_code != 200:
            return self.create_text_message(f"Got Error Response:{response.text}")

        return [self.create_text_message(response.content.decode("utf-8"))]
