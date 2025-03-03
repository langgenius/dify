import json
from collections.abc import Generator
from typing import Any, Optional

import requests

from configs import dify_config
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage


class SelectContainerRSSTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        container_name = tool_parameters.get("container")
        start_time = tool_parameters.get("startTime")
        end_time = tool_parameters.get("endTime")
        pmql = 'container_memory_rss{container="' + container_name + '"}'
        params = {
          'query': pmql,
          'start': start_time,
          'end': end_time,
          'step': '1m'
          }
        resp = requests.get(dify_config.APO_VM_URL + '/api/v1/query_range', params=params)
        list = resp.json()['data']['result'][0]
        res = {}
        for item in list['values']:
            res[str(item[0] * 1000)] = float(item[1])
        list = json.dumps({
            'type': 'memory',
            'display': True,
            'data': res,
        })
        yield self.create_text_message(list)