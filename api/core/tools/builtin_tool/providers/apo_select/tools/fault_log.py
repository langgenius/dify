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
        pod = tool_parameters.get("pod")
        params = {
          'service': [service],
          'startTime': start_time,
          'endTime': end_time,
          'pageNum': 1,
          'pageSize': 10,
          'pod': pod,
          }
        url = dify_config.APO_BACKEND_URL + "/api/log/fault/pagelist" 
        resp = requests.post(url, json=params)
        log_list = resp.json().get('list', [])
        list = []
        if not log_list:
            yield self.create_text_message('')
        else:
            list = log_list[0]
        
        content_url = dify_config.APO_BACKEND_URL + "/api/log/fault/content"
        content = requests.post(content_url, json=list).json()
        list = json.dumps({
            'type': 'log',
            'display': True,
            'data': content,
        })
        yield self.create_text_message(list)