import json
from collections.abc import Generator
from typing import Any, Optional

import requests

from configs import dify_config
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage


class SelectCPUTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        node_name = tool_parameters.get("node_name")
        start_time = tool_parameters.get("start_time")
        end_time = tool_parameters.get("end_time")
        sumql = 'sum by (instance_name) (avg by (mode, instance_name)'
        pmql = sumql + ' (rate(node_cpu_seconds_total{mode!="idle", instance_name="' + node_name + '"}[1m])))'
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
            'type': 'cpu',
            'display': True,
            'data': res,
        })
        yield self.create_text_message(list)