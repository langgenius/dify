import json
from collections.abc import Generator
from typing import Any, Optional

import requests

from configs import dify_config
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage


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
          'step': self.get_step(start_time, end_time),
          }
        resp = requests.post(dify_config.APO_BACKEND_URL + '/api/alerts/descendant/anormal/delta', json=params)
        list = resp.json()
        list = json.dumps({
            'type': 'alert',
            'display': True,
            'data': list,
        })
        yield self.create_text_message(list)

    def get_step(self, start_time, end_time):
        time_diff = end_time - start_time

        SECOND = 1000000  # microseconds
        MINUTE = 60 * SECOND
        HOUR = 60 * MINUTE

        step = SECOND  # default step is 1 second

        if time_diff <= 15 * MINUTE:
            step = 30 * SECOND
        elif time_diff <= 30 * MINUTE:
            step = 1 * MINUTE
        elif time_diff <= 1 * HOUR:
            step = 2 * MINUTE
        elif time_diff <= 1.5 * HOUR:
            step = 3 * MINUTE
        elif time_diff <= 3 * HOUR:
            step = 6 * MINUTE
        elif time_diff <= 6 * HOUR:
            step = 12 * MINUTE
        elif time_diff <= 12 * HOUR:
            step = 24 * MINUTE
        elif time_diff <= 15 * HOUR:
            step = 30 * MINUTE
        elif time_diff <= 30 * HOUR:
            step = 1 * HOUR
        else:
            step = ((time_diff + 30 * SECOND - 1) // (30 * SECOND)) * SECOND

        return step