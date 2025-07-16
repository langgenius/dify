import json
from collections.abc import Generator
from typing import Any, Optional

import requests

from configs import dify_config
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from libs.apo_utils import APOUtils


class PolarisTimeByPidTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        pid = APOUtils.get_and_fill_param(tool_parameters, 'pid')
        start_time = tool_parameters.get("startTime")
        end_time = tool_parameters.get("endTime")
        resource_type = APOUtils.get_and_fill_param(tool_parameters, 'type')
        step = APOUtils.get_step(start_time=start_time, end_time=end_time)
        interval = APOUtils.vec_from_duration(step * 1000)
        if len(pid) == 0:
            pid = '.*'
        if len(resource_type) == 0:
            resource_type = '.*'

        query = f"""
        increase(
          sum without (tid_key) (
            originx_thread_polaris_nanoseconds_sum{{
              container_id!="",
              type=~"{resource_type}",
              pid=~"{pid}"
            }}[{interval}]
          )
        )
        """
        resp = requests.get(
            dify_config.APO_VM_URL + "/prometheus/api/v1/query_range",
            params={
                'query': query,
                'start': start_time / 1000,
                'end': end_time / 1000,
                'step': APOUtils.get_step_with_unit(start_time, end_time)
            }
        ).json()

        timeseries = []
        for res in resp.get('data', {}).get('result', []):
            labels = res.get('metric')
            chart_data = {}
            for pair in res.get('values', []):
                if len(pair) < 2:
                    continue
                try:
                    value = float(pair[1])
                    chart_data[pair[0] * 1_000_000] = value
                except (ValueError, TypeError) as e:
                    continue
            timeseries.append(
                {
                    "labels": labels,
                    "legend": f"{labels.get('pid')}",
                    "chart": {
                        "chartData": chart_data,
                    }
                }
            )      
        # timeseries数组 [{"labels": {}, "chart:{"chartData": {"time": value}"}}]
        resp_json = json.dumps({
            'type': 'metric',
            'display': True,
            'unit': 'us',
            'data': {
                'timeseries': timeseries
            }
        })
        yield self.create_text_message(resp_json)