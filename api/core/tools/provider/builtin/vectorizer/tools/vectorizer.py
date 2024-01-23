from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage, ToolParamter
from core.tools.provider.builtin.vectorizer.tools.test_data import VECTORIZER_ICON_PNG
from core.tools.errors import ToolProviderCredentialValidationError

from typing import Any, Dict, List, Union
from httpx import post
from base64 import b64decode

class VectorizerTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_paramters: Dict[str, Any]) \
        -> Union[ToolInvokeMessage, List[ToolInvokeMessage]]:
        """
            invoke tools
        """
        api_key_name = self.runtime.credentials.get('api_key_name', None)
        api_key_value = self.runtime.credentials.get('api_key_value', None)
        mode = tool_paramters.get('mode', 'test')
        if mode == 'production':
            mode = 'preview'

        if not api_key_name or not api_key_value:
            raise ToolProviderCredentialValidationError('Please input api key name and value')

        image_id = tool_paramters.get('image_id', '')
        if not image_id:
            return self.create_text_message('Please input image id')
        
        if image_id.startswith('__test_'):
            image_binary = b64decode(VECTORIZER_ICON_PNG)
        else:
            image_binary = self.get_variable_file(self.VARIABLE_KEY.IMAGE)
            if not image_binary:
                return self.create_text_message('Image not found, please request user to generate image firstly.')

        response = post(
            'https://vectorizer.ai/api/v1/vectorize',
            files={
                'image': image_binary
            },
            data={
                'mode': mode
            } if mode == 'test' else {},
            auth=(api_key_name, api_key_value), 
            timeout=30
        )

        if response.status_code != 200:
            raise Exception(response.text)
        
        return [
            self.create_text_message('the vectorized svg is saved as an image.'),
            self.create_blob_message(blob=response.content,
                                    meta={'mime_type': 'image/svg+xml'})
        ]
    
    def get_runtime_parameters(self) -> List[ToolParamter]:
        """
        override the runtime parameters
        """
        return [
            ToolParamter.get_simple_instance(
                name='image_id',
                llm_description=f'the image id that you want to vectorize, \
                    and the image id should be specified in \
                        {[i.name for i in self.list_default_image_variables()]}',
                type=ToolParamter.ToolParameterType.SELECT,
                required=True,
                options=[i.name for i in self.list_default_image_variables()]
            )
        ]
    
    def is_tool_avaliable(self) -> bool:
        return len(self.list_default_image_variables()) > 0