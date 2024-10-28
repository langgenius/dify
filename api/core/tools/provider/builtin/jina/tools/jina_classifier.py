from typing import Any

from core.helper import ssrf_proxy
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class JinaClassifierTool(BuiltinTool):
    _jina_classifier_endpoint = "https://api.jina.ai/v1/classify"

    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> ToolInvokeMessage:
        model = tool_parameters["model"]
        input_ = tool_parameters["input"]
        labels = tool_parameters.get("labels")
        labels = labels.split('||')
        body = {"model": model, "input": [input_], "labels": labels}

        headers = {"Content-Type": "application/json"}

        if "api_key" in self.runtime.credentials and self.runtime.credentials.get("api_key"):
            headers["Authorization"] = "Bearer " + self.runtime.credentials.get("api_key")

        response = ssrf_proxy.post(
            self._jina_classifier_endpoint,
            headers=headers,
            json=body,
        )

        return self.create_json_message(response.json())
