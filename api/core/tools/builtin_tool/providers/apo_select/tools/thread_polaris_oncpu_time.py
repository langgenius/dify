import json
from collections.abc import Generator
from typing import Any, Optional

import requests

from configs import dify_config
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from libs.apo_utils import APOUtils


class ThreadPolarisOncpuTimeTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        pod = tool_parameters.get('pod', '')
        node_name = tool_parameters.get('nodeName', '')
        pid = tool_parameters.get('pid', '')
        container_id = tool_parameters.get('containerId', '')
        start_time = tool_parameters.get("startTime")
        end_time = tool_parameters.get("endTime")

        metric_params = {
            'node_name': node_name if node_name != '' else '.*',
            'container_id': container_id if container_id != '' else '.*',
            'pid': pid if pid != '' else '.*',
            'pod': pod if pod != '' else '.*',
        }

        params = {
            'metricName': 'Thread Polaris Metrics - 北极星指标（线程） - 各类型耗时折线图 - OnCPU',
            'params': metric_params,
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