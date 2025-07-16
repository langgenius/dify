import json
from collections.abc import Generator
from typing import Any, Optional

import requests

from configs import dify_config
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from libs.apo_utils import APOUtils

class HostCPUIoWaitRespTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        node = APOUtils.get_and_fill_param(tool_parameters, 'node')
        start_time = tool_parameters.get("startTime")
        end_time = tool_parameters.get("endTime")
        job = tool_parameters.get('job')
        if not job:
            job = '.*'
        params = {
          'metricName': '宿主机监控指标 - Storage Filesystem - File Descriptor - Open files',
          'params': {
            "node": node,
            "job": job,
          },
          'startTime': start_time,
          'endTime': end_time,
          'step': APOUtils.get_step(start_time, end_time),
          }
        resp = requests.post(
            f'{dify_config.APO_BACKEND_URL}/api/metric/query', json=params
        )
        resp_data = resp.json()
        list = resp_data["result"]
        list = json.dumps({
            'type': 'metric',
            'display': True,
            'unit': list['unit'],
            'data': {
                "timeseries": list['timeseries']
            }
        })
        yield self.create_text_message(list)