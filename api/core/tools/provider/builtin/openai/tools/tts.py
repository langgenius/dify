from base64 import b64decode
from typing import Any, Union

from openai import OpenAI
from yarl import URL

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.tool_file_manager import ToolFileManager


class OpenAITTSTool(BuiltinTool):
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
            openai_base_url = str(URL(openai_base_url) / 'v1')

        client = OpenAI(
            api_key=self.runtime.credentials['openai_api_key'],
            base_url=openai_base_url,
            organization=openai_organization
        )

        # text_input
        text_input = tool_parameters.get('text', '')
        if not text_input:
            return self.create_text_message('Please input text')
        # get voice
        voice = tool_parameters.get('voice', 'alloy')
        # get model
        model = tool_parameters.get('model', 'tts-1')

        response = client.audio.speech.create(
            model=model,
            voice=voice,
            input=text_input
        )

        result = self.create_blob_message(blob=response.read(),
                                             meta={ 'mime_type': 'audio/mpeg' },
                                            save_as=self.VARIABLE_KEY.AUDIO.value)

        return result
