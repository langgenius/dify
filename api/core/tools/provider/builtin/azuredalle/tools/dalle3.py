import random
from base64 import b64decode
from typing import Any, Union

from openai import AzureOpenAI

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class DallE3Tool(BuiltinTool):
    def _invoke(self,
                user_id: str,
                tool_parameters: dict[str, Any],
                ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
            invoke tools
        """
        client = AzureOpenAI(
            api_version=self.runtime.credentials['azure_openai_api_version'],
            azure_endpoint=self.runtime.credentials['azure_openai_base_url'],
            api_key=self.runtime.credentials['azure_openai_api_key'],
        )

        SIZE_MAPPING = {
            'square': '1024x1024',
            'vertical': '1024x1792',
            'horizontal': '1792x1024',
        }

        # prompt
        prompt = tool_parameters.get('prompt', '')
        if not prompt:
            return self.create_text_message('Please input prompt')
        # get size
        size = SIZE_MAPPING[tool_parameters.get('size', 'square')]
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

        # call openapi dalle3
        model = self.runtime.credentials['azure_openai_api_model_name']
        response = client.images.generate(
            prompt=prompt,
            model=model,
            size=size,
            n=n,
            extra_body=extra_body,
            style=style,
            quality=quality,
            response_format='b64_json'
        )

        result = []

        for image in response.data:
            result.append(self.create_blob_message(blob=b64decode(image.b64_json),
                                                   meta={'mime_type': 'image/png'},
                                                   save_as=self.VARIABLE_KEY.IMAGE.value))
        result.append(self.create_text_message(f'\nGenerate image source to Seed ID: {seed_id}'))

        return result

    @staticmethod
    def _generate_random_id(length=8):
        characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
        random_id = ''.join(random.choices(characters, k=length))
        return random_id
