import time
from typing import Any, Union

from zhipuai import ZhipuAI  # type: ignore

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class CogVideoXTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        client = ZhipuAI(
            base_url=self.runtime.credentials["zhipuai_base_url"],
            api_key=self.runtime.credentials["zhipuai_api_key"],
        )
        prompt = tool_parameters.get("prompt")
        image_url = tool_parameters.get("image_url")
        if not prompt and not image_url:
            return self.create_text_message("require at least one of prompt and image_url")

        model = tool_parameters.get("model", "cogvideox-flash")
        quality = tool_parameters.get("quality", "speed")
        with_audio = tool_parameters.get("with_audio", False)
        size = tool_parameters.get("size")
        fps = tool_parameters.get("fps", 30)
        timeout = tool_parameters.get("timeout", 180)

        try:
            start_time = time.time()
            response = client.videos.generations(
                model=model,
                prompt=prompt,
                image_url=image_url,
                quality=quality,
                with_audio=with_audio,
                size=size,
                fps=fps,
            )
            video_id = response.id
            res = client.videos.retrieve_videos_result(video_id)
            while res.task_status == "PROCESSING" and time.time() - start_time < timeout:
                time.sleep(1)
                res = client.videos.retrieve_videos_result(video_id)
            if res.task_status == "FAIL":
                return self.create_text_message("generate video failed")

        except:
            return self.create_text_message("generate video failed")

        return self.create_json_message(res.dict())
