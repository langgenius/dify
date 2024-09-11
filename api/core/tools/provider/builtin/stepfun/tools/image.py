import random
from typing import Any, Union

from openai import OpenAI
from yarl import URL

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class StepfunTool(BuiltinTool):
    """Stepfun Image Generation Tool"""

    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        base_url = self.runtime.credentials.get("stepfun_base_url", "https://api.stepfun.com")
        base_url = str(URL(base_url) / "v1")

        client = OpenAI(
            api_key=self.runtime.credentials["stepfun_api_key"],
            base_url=base_url,
        )

        extra_body = {}
        model = tool_parameters.get("model", "step-1x-medium")
        if not model:
            return self.create_text_message("Please input model name")
        # prompt
        prompt = tool_parameters.get("prompt", "")
        if not prompt:
            return self.create_text_message("Please input prompt")

        seed = tool_parameters.get("seed", 0)
        if seed > 0:
            extra_body["seed"] = seed
        steps = tool_parameters.get("steps", 0)
        if steps > 0:
            extra_body["steps"] = steps
        negative_prompt = tool_parameters.get("negative_prompt", "")
        if negative_prompt:
            extra_body["negative_prompt"] = negative_prompt

        # call openapi stepfun model
        response = client.images.generate(
            prompt=prompt,
            model=model,
            size=tool_parameters.get("size", "1024x1024"),
            n=tool_parameters.get("n", 1),
            extra_body=extra_body,
        )
        print(response)

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
