from typing import Any, Union
import logging

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool
import json
from ai_service_python_sdk.client.api_client import ApiClient
from ai_service_python_sdk.client.api.ai_service_image_api import AiServiceImageApi


logger = logging.getLogger(__name__)

class MultimediaAnalysisTool(BuiltinTool):
    ai_service_client: Any = None
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke request

        Args:
            user_id (str): user_id
            tool_parameters (dict[str, Any]): tool_parameters

        Returns:
            Union[ToolInvokeMessage, list[ToolInvokeMessage]]: text_message
        """
        if not self.ai_service_client:
            endpoint_url = tool_parameters['endpoint_url']
            token = tool_parameters['token']
            app_id = tool_parameters['app_id']
            self.ai_service_client = ApiClient(endpoint_url, app_id, token)
            
        image_url = tool_parameters.get("image_url","")
        if not image_url:
            return self.create_text_message("please input image url")
        text = tool_parameters.get("text","")
        model_name = tool_parameters.get("model_name","")
        
        ai_service_api = AiServiceImageApi(self.ai_service_client)
        configure = {'tag_top_k': 5, 'output_embedding': False}
        
        # 请求服务。
        response = ai_service_api.multi_label_image_v2(image_url, model_name, configure)

        return self.create_text_message(response.data)