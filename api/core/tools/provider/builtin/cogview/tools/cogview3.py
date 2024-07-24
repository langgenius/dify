import random
from typing import Any, Union

from core.model_runtime.model_providers.zhipuai.zhipuai_sdk._client import ZhipuAI
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class CogView3Tool(BuiltinTool):
    """ CogView3 Tool """

    def _invoke(self,
                user_id: str,
                tool_parameters: dict[str, Any]
                ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        Invoke CogView3 tool
        """
        client = ZhipuAI(
            base_url=self.runtime.credentials['zhipuai_base_url'],
            api_key=self.runtime.credentials['zhipuai_api_key'],
        )
        size_mapping = {
            'square': '1024x1024',
            'vertical': '1024x1792',
            'horizontal': '1792x1024',
        }
        # prompt
        prompt = tool_parameters.get('prompt', '')
        if not prompt:
            return self.create_text_message('Please input prompt')
        # get size
        print(tool_parameters.get('prompt', 'square'))
        size = size_mapping[tool_parameters.get('size', 'square')]
        # get n
        n = tool_parameters.get('n', 1)
        # get quality
        quality = tool_parameters.get('quality', 'standard')
        if quality not in ['standard', 'hd']:
            return self.create_text_message('Invalid quality')
        # get style
        style = tool_parameters.get('style', 'vivid')
        if style not in ['natural', 'vivid']:
            return self.create_text_message('Invalid style')
        # set extra body
        seed_id = tool_parameters.get('seed_id', self._generate_random_id(8))
        extra_body = {'seed': seed_id}
        response = client.images.generations(
            prompt=prompt,
            model="cogview-3",
            size=size,
            n=n,
            extra_body=extra_body,
            style=style,
            quality=quality,
            response_format='b64_json'
        )
        result = []
        for image in response.data:
            result.append(self.create_image_message(image=image.url))
        result.append(self.create_text_message(
            f'\nGenerate image source to Seed ID: {seed_id}'))
        return result

    @staticmethod
    def _generate_random_id(length=8):
        characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
        random_id = ''.join(random.choices(characters, k=length))
        return random_id
