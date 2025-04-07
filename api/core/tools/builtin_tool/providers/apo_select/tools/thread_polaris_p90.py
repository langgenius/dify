import json
from collections.abc import Generator
from typing import Any, Optional

import requests

from configs import dify_config
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from libs.apo_utils import APOUtils


class ThreadPolarisP90(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        pod = tool_parameters.get('pod', '.*')
        start_time = tool_parameters.get("startTime")
        end_time = tool_parameters.get("endTime")
        type = tool_parameters.get('type')
        metrics = self.get_metrics(type, pod, start_time, end_time)
        res = self.get_max_min(metrics)
        list = json.dumps({
            'type': 'p90',
            'data': res
        })
        yield self.create_text_message(list)

    def get_max_min(self, data_json) -> str:
        results = data_json["data"]["result"]

        stats = {}

        for entry in results:
            tid = entry["metric"]["tid"]
            values = [float(value[1]) for value in entry["values"]]
    
            stats[tid] = {
                "avg": sum(values) / len(values),
            }

        return json.dumps(stats)

    def get_metrics(self, type: str, pod: str, start: int, end: int) -> dict:
        query = 'increase(originx_thread_polaris_nanoseconds_sum{pod="' + pod + '", type="cpu"}[1m])'
        step = '10m'
        hour = 3600 * 1000

        res = requests.get(
            dify_config.APO_VM_URL + "/prometheus/api/v1/query_range",
            params={
              'query': query,
              'start': end / 1000 - hour,
              'end': end / 1000,
              'step': step
            }
        )

        return res.json()