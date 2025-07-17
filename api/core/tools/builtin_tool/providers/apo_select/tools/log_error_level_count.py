import json
from collections.abc import Generator
from typing import Any, Optional

import requests

from configs import dify_config
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from libs.apo_utils import APOUtils


class LogErrorLevelCountTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        pod_name = tool_parameters.get('pod_name', '.*')
        namespace = tool_parameters.get('namespace', '.*')
        pid = tool_parameters.get('pid', '.*')
        start_time = tool_parameters.get("startTime")
        end_time = tool_parameters.get("endTime")
        params = {
            'metricName': '宿主机监控指标 - 日志解析错误计数总览 - log error level count',
            'params': {
                'pod_name': pod_name,
                'namespace': namespace,
                'pid': pid
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