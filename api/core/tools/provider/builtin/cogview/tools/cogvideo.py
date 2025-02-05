from typing import Any, Union

from zhipuai import ZhipuAI  # type: ignore

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class CogVideoTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        client = ZhipuAI(
            base_url=self.runtime.credentials["zhipuai_base_url"],
            api_key=self.runtime.credentials["zhipuai_api_key"],
        )
        if not tool_parameters.get("prompt") and not tool_parameters.get("image_url"):
            return self.create_text_message("require at least one of prompt and image_url")

        response = client.videos.generations(
            model="cogvideox", prompt=tool_parameters.get("prompt"), image_url=tool_parameters.get("image_url")
        )

        return self.create_json_message(response.dict())
