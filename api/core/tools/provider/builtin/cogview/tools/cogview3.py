import random
from typing import Any, Union

from zhipuai import ZhipuAI  # type: ignore

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class CogView3Tool(BuiltinTool):
    """CogView3 Tool"""

    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        Invoke CogView3 tool
        """
        client = ZhipuAI(
            base_url=self.runtime.credentials["zhipuai_base_url"],
            api_key=self.runtime.credentials["zhipuai_api_key"],
        )
        size_mapping = {
            "square": "1024x1024",
            "vertical_768": "768x1344",
            "vertical_864": "864x1152",
            "horizontal_1344": "1344x768",
            "horizontal_1152": "1152x864",
            "widescreen_1440": "1440x720",
            "tallscreen_720": "720x1440",
        }
        # prompt
        prompt = tool_parameters.get("prompt", "")
        if not prompt:
            return self.create_text_message("Please input prompt")
        # get size key
        size_key = tool_parameters.get("size", "square")
        # cogview-3-plus get size
        if size_key != "cogview_3":
            size = size_mapping[size_key]
        # get n
        n = tool_parameters.get("n", 1)
        # get quality
        quality = tool_parameters.get("quality", "standard")
        if quality not in {"standard", "hd"}:
            return self.create_text_message("Invalid quality")
        # get style
        style = tool_parameters.get("style", "vivid")
        if style not in {"natural", "vivid"}:
            return self.create_text_message("Invalid style")
        # set extra body
        seed_id = tool_parameters.get("seed_id", self._generate_random_id(8))
        extra_body = {"seed": seed_id}
        # cogview-3-plus
        if size_key != "cogview_3":
            response = client.images.generations(
                prompt=prompt,
                model="cogview-3-plus",
                size=size,
                n=n,
                extra_body=extra_body,
                style=style,
                quality=quality,
                response_format="b64_json",
            )
        # cogview-3
        else:
            response = client.images.generations(
                prompt=prompt,
                model="cogview-3",
                n=n,
                extra_body=extra_body,
                style=style,
                quality=quality,
                response_format="b64_json",
            )
        result = []
        for image in response.data:
            result.append(self.create_image_message(image=image.url))
            result.append(
                self.create_json_message(
                    {
                        "url": image.url,
                    }
                )
            )
        return result

    @staticmethod
    def _generate_random_id(length=8):
        characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
        random_id = "".join(random.choices(characters, k=length))
        return random_id
