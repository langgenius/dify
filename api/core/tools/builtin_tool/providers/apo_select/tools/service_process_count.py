import json
from collections.abc import Generator
from typing import Any, Optional

import requests

from configs import dify_config
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from libs.apo_utils import APOUtils


class ServiceProcessCount(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        end_time = tool_parameters.get("endTime")
        workload_name = tool_parameters.get("workloadName")
        comm = tool_parameters.get("comm")
        is_history = tool_parameters.get("isHistory")
        node_name = tool_parameters.get("nodeName")

        label_filters = []
        if node_name:
            label_filters = [f'node_name="{node_name}"']
        if workload_name:
            label_filters.append(f'workload_name="{workload_name}"')
        if comm:
            label_filters.append(f'comm="{comm}"')

        label_str = ""
        if label_filters:
            label_str = "{" + ",".join(label_filters) + "}"

        query = ""
        if not is_history:
            query = f"count(originx_process_last_seen{label_str})"
        else:
            query = (
                f"avg_over_time("
                f"count(originx_process_last_seen{label_str})[10m:])"
            )
        params = {
            "query": query,
            "time": end_time / 1000,
        }

        try:
            resp = requests.get(dify_config.APO_VM_URL + "/prometheus/api/v1/query", params=params, timeout=10)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            yield self.create_text_message(json.dumps({
                "type": "error",
                "display": False,
                "data": str(e)
            }))
            return

        count = 0
        for res in data.get("data", {}).get("result", []):
            value_pair = res.get("value", [])
            if len(value_pair) == 2:
                try:
                    count = float(value_pair[1])
                except Exception:
                    pass
            

        resp_json = json.dumps({
            "type": "metric",
            "display": False,
            "unit": "count",
            "data": count
        })
        yield self.create_text_message(resp_json)
