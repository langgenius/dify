from typing import Any, Union
import logging

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool
import dashscope


logger = logging.getLogger(__name__)

class QwenVLTool(BuiltinTool):
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
        token = str(tool_parameters.get("token",""))
        model_name = str(tool_parameters.get("model_name","qwen-vl-max"))
        images = str(tool_parameters.get("images",""))
        text = str(tool_parameters.get("text",""))
        
        image_arr = images.strip().split(",")
        content = []
        for image in image_arr:
            image = image.strip()
            content.append({"image": image})
        if not text.strip():
            content.append({"text": text.strip()})
        messages = [
            {
                "role": "user",
                "content": content
            }
        ]
        
        response = dashscope.MultiModalConversation.call(
            api_key=token,
            model=model_name,
            messages=messages
            )
        return self.create_json_message(response.output)