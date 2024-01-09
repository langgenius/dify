from typing import Any, Dict, List, Union
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.provider.tool_provider import Tool
from core.model_runtime.entities.message_entities import PromptMessage

from base64 import b64decode

from openai import OpenAI

class DallE3Tool(Tool):
    def _invoke(self, 
               tool_paramters: Dict[str, Any], 
               credentials: Dict[str, Any], 
               prompt_messages: List[PromptMessage]
        ) -> Union[ToolInvokeMessage, List[ToolInvokeMessage]]:
        """
            invoke tools
        """
        openai_organization = credentials.get('openai_organizaion_id', None)
        openai_base_url = credentials.get('openai_base_url', None)

        client = OpenAI(
            api_key=credentials['openai_api_key'],
            base_url=openai_base_url,
            organization=openai_organization
        )

        SIZE_MAPPING = {
            'square': '1024x1024',
            'vertical': '1024x1792',
            'horizontal': '1792x1024',
        }

        # prompt
        prompt = tool_paramters.get('prompt', '')
        if not prompt:
            return self.create_text_message('Please input prompt')
        # get size
        size = SIZE_MAPPING[tool_paramters.get('size', 'square')]
        # get n
        n = tool_paramters.get('n', 1)
        # get quality
        quality = tool_paramters.get('quality', 'standard')
        if quality not in ['standard', 'hd']:
            return self.create_text_message('Invalid quality')
        # get style
        style = tool_paramters.get('style', 'vivid')
        if style not in ['natural', 'vivid']:
            return self.create_text_message('Invalid style')

        # call openapi dalle3
        response = client.images.generate(
            prompt=prompt,
            model='dall-e-3',
            size=size,
            n=n,
            style=style,
            quality=quality,
            response_format='b64_json'
        )

        result = []

        for image in response.data:
            result.append(self.create_blob_message(blob=b64decode(image.b64_json), meta={
                'mime_type': 'image/png'
            }))

        return result

    def validate_credentials(self, credentails: Dict[str, Any], parameters: Dict[str, Any]) -> None:
        pass