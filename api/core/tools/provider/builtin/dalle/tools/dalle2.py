from base64 import b64decode
from os.path import join
from typing import Any, Union

from openai import OpenAI

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class DallE2Tool(BuiltinTool):
    def _invoke(self, 
                user_id: str, 
               tool_parameters: dict[str, Any], 
        ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
            invoke tools
        """
        openai_organization = self.runtime.credentials.get('openai_organizaion_id', None)
        if not openai_organization:
            openai_organization = None
        openai_base_url = self.runtime.credentials.get('openai_base_url', None)
        if not openai_base_url:
            openai_base_url = None
        else:
            openai_base_url = join(openai_base_url, 'v1')

        client = OpenAI(
            api_key=self.runtime.credentials['openai_api_key'],
            base_url=openai_base_url,
            organization=openai_organization
        )

        SIZE_MAPPING = {
            'small': '256x256',
            'medium': '512x512',
            'large': '1024x1024',
        }

        # prompt
        prompt = tool_parameters.get('prompt', '')
        if not prompt:
            return self.create_text_message('Please input prompt')
        
        # get size
        size = SIZE_MAPPING[tool_parameters.get('size', 'large')]

        # get n
        n = tool_parameters.get('n', 1)

        # call openapi dalle2
        response = client.images.generate(
            prompt=prompt,
            model='dall-e-2',
            size=size,
            n=n,
            response_format='b64_json'
        )

        result = []

        for image in response.data:
            result.append(self.create_blob_message(blob=b64decode(image.b64_json), 
                                                   meta={ 'mime_type': 'image/png' },
                                                    save_as=self.VARIABLE_KEY.IMAGE.value))

        return result
