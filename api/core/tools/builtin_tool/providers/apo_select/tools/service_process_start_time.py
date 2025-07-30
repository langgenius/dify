import json
from collections.abc import Generator
from typing import Any, Optional

import requests

from configs import dify_config
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from libs.apo_utils import APOUtils

# TODO need more test
class ServiceProcessStartTime(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        start_time = tool_parameters.get("startTime")
        end_time = tool_parameters.get("endTime")
        workload_name = tool_parameters.get("workloadName")
        comm = tool_parameters.get("comm")
        node_name = tool_parameters.get("nodeName")
        pid = tool_parameters.get("pid")

        by_labels = ["node_name"]
        label_filters = []
        if node_name:
            label_filters = [f'node_name="{node_name}"']
        if workload_name:
            label_filters.append(f'workload_name="{workload_name}"')
            by_labels.append("workload_name")
        if comm:
            label_filters.append(f'comm="{comm}"')
            by_labels.append("comm")
        if pid:
            label_filters.append(f'pid="{pid}"')

        label_str = "{" + ",".join(label_filters) + "}"
        by_str = ",".join(by_labels)

        query = f"min(originx_process_start_time{label_str}) by({by_str})"
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

        start_time = ""
        for res in data.get("data", {}).get("result", []):
            value_pair = res.get("value", [])
            if len(value_pair) == 2:
                try:
                    start_time = value_pair[1]
                except Exception:
                    pass
            

        resp_json = json.dumps({
            "type": "metric",
            "display": False,
            "unit": "s",
            "data": start_time
        })
        yield self.create_text_message(resp_json)
