import json
from collections.abc import Generator
from typing import Any, Optional

import requests

from configs import dify_config
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from libs.apo_utils import APOUtils


class AlertTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        service = tool_parameters.get("service")
        endpoint = tool_parameters.get("endpoint")
        start_time = tool_parameters.get("startTime")
        end_time = tool_parameters.get("endTime")
        params = {
          'service': service,
          'endpoint': endpoint,
          'startTime': start_time,
          'endTime': end_time,
          'anormalTypes': "app,container,infra,network,error,appInstance",
          'deltaStartTime': start_time,
          'deltaEndTime': end_time,
          'step': APOUtils.get_step(start_time, end_time),
          }
        resp = requests.post(dify_config.APO_BACKEND_URL + '/api/alerts/descendant/anormal/delta', json=params)
        list = resp.json()
        list = json.dumps({
            'type': 'alert',
            'display': True,
            'data': list,
        })
        yield self.create_text_message(list)