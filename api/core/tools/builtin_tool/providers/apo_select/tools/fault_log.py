import json
from collections.abc import Generator
from typing import Any, Optional

import requests

from configs import dify_config
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage


class FaultLogTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        service = tool_parameters.get("service")
        start_time = tool_parameters.get("startTime")
        end_time = tool_parameters.get("endTime")
        params = {
          'service': [service],
          'startTime': start_time,
          'endTime': end_time,
          'pageNum': 1,
          'pageSize': 10
          }
        url = dify_config.APO_BACKEND_URL + "/api/log/fault/pagelist" 
        resp = requests.post(url, json=params)
        list = resp.json()['list'][0]
        
        content_url = dify_config.APO_BACKEND_URL + "/api/log/fault/content"
        content = requests.post(content_url, json=list).json()
        list = json.dumps({
            'type': 'log',
            'display': True,
            'data': content,
        })
        yield self.create_text_message(list)