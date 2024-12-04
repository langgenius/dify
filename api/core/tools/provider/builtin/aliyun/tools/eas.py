import json
import logging
from typing import Any, Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool

logger = logging.getLogger(__name__)


class EasTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke eas request

        Args:
            user_id (str): user_id
            tool_parameters (dict[str, Any]): tool_parameters

        Returns:
            Union[ToolInvokeMessage, list[ToolInvokeMessage]]: text_message
        """
        eas_endpoint_url = tool_parameters["eas_endpoint_url"]
        eas_token = tool_parameters["eas_token"]
        headers = {"Authorization": eas_token}
        query = tool_parameters["query"]
        json_data = json.loads(query)
        return self.create_text_message(text=requests.post(eas_endpoint_url, data=json_data, headers=headers).text)
