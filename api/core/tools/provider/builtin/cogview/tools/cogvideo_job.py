from typing import Any, Union

import httpx
from zhipuai import ZhipuAI

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class CogVideoJobTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        client = ZhipuAI(
            api_key=self.runtime.credentials["zhipuai_api_key"],
            base_url=self.runtime.credentials["zhipuai_base_url"],
        )

        response = client.videos.retrieve_videos_result(id=tool_parameters.get("id"))
        result = [self.create_json_message(response.dict())]
        if response.task_status == "SUCCESS":
            for item in response.video_result:
                video_cover_image = self.create_image_message(item.cover_image_url)
                result.append(video_cover_image)
                video = self.create_blob_message(
                    blob=httpx.get(item.url).content, meta={"mime_type": "video/mp4"}, save_as=self.VariableKey.VIDEO
                )
                result.append(video)

        return result
