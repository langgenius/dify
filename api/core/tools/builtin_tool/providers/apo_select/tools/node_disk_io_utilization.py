import json
from collections.abc import Generator
from typing import Any, Optional

import requests

from configs import dify_config
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from libs.apo_utils import APOUtils


class NodeDiskIoUtilizationTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        job = APOUtils.get_and_fill_param(tool_parameters, 'job')
        node = APOUtils.get_and_fill_param(tool_parameters, 'node')
        start_time = tool_parameters.get("startTime")
        end_time = tool_parameters.get("endTime")
        if not job:
            job = '.*'
        params = {
            'metricName': '宿主机监控指标 - CPU / Memory / Net / Disk - I/O Utilization',
            'params': {
                'job': job,
                'node': node
            },
            'startTime': start_time,
            'endTime': end_time,
            'step': APOUtils.get_step(start_time, end_time),
        }
        resp = requests.post(dify_config.APO_BACKEND_URL + '/api/metric/query', json=params)
        list = resp.json()['result']
        list = json.dumps({
            'type': 'metric',
            'display': True,
            'unit': list['unit'],
            'data': {
                'timeseries': list['timeseries']
            }
        })
        yield self.create_text_message(list)