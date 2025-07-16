import json
from collections.abc import Generator
from typing import Any, Optional

import requests

from configs import dify_config
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from libs.apo_utils import APOUtils


class NamespaceMemoryUsageDockerBytesTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        cadvisor_job_name = APOUtils.get_and_fill_param(tool_parameters, 'cadvisor_job_name')
        cluster = APOUtils.get_and_fill_param(tool_parameters, 'cluster')
        start_time = tool_parameters.get("startTime")
        end_time = tool_parameters.get("endTime")
        params = {
            'metricName': '集群总览 - 命名空间资源使用 - 命名空间的内存使用量 - Docker',
            'params': {
                'cadvisor_job_name': cadvisor_job_name,
                'cluster': cluster
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