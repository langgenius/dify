from typing import Any, Dict, List, Union
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.provider.tool_provider import Tool
from core.tools.provider.builtin_tool import BuiltinTool
from core.model_runtime.entities.message_entities import PromptMessage

from base64 import b64decode

from openai import OpenAI

class DallE2Tool(BuiltinTool):
    def _invoke(self, 
                user_id: str, 
               tool_paramters: Dict[str, Any], 
        ) -> Union[ToolInvokeMessage, List[ToolInvokeMessage]]:
        """
            invoke tools
        """
        openai_organization = self.meta.credentials.get('openai_organizaion_id', None)
        openai_base_url = self.meta.credentials.get('openai_base_url', None)

        client = OpenAI(
            api_key=self.meta.credentials['openai_api_key'],
            base_url=openai_base_url,
            organization=openai_organization
        )

        SIZE_MAPPING = {
            'small': '256x256',
            'medium': '512x512',
            'large': '1024x1024',
        }

        # prompt
        prompt = tool_paramters.get('prompt', '')
        if not prompt:
            return self.create_text_message('Please input prompt')
        
        # get size
        size = SIZE_MAPPING[tool_paramters.get('size', 'large')]

        # get n
        n = tool_paramters.get('n', 1)

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
            result.append(self.create_blob_message(blob=b64decode(image.b64_json), meta={
                'mime_type': 'image/png'
            }))

        return result

    def validate_credentials(self, credentails: Dict[str, Any], parameters: Dict[str, Any]) -> None:
        pass