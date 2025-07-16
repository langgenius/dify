import json
from collections.abc import Generator
from typing import Any, Optional

import requests

from configs import dify_config
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from libs.apo_utils import APOUtils


class ThreadPolarisOtherTimeTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        pod = APOUtils.get_and_fill_param(tool_parameters, 'pod')
        node_name = APOUtils.get_and_fill_param(tool_parameters, 'nodeName')
        pid = APOUtils.get_and_fill_param(tool_parameters, 'pid')
        container_id = APOUtils.get_and_fill_param(tool_parameters, 'containerId')
        start_time = tool_parameters.get("startTime")
        end_time = tool_parameters.get("endTime")

        metric_params = {
            'node_name': node_name,
            'container_id': container_id,
            'pid': pid,
            'pod': pod,
        }

        params = {
            'metricName': 'Thread Polaris Metrics - 北极星指标（线程） - 各类型耗时折线图 - Other',
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