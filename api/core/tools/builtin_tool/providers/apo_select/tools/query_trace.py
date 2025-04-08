import json
from collections.abc import Generator
from typing import Any, Optional

import requests

from configs import dify_config
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage


class QueryTraceTool(BuiltinTool):
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
        service = tool_parameters.get("service")
        namespace = tool_parameters.get("namespace")
        endpoint = tool_parameters.get("endpoint")
        instance = tool_parameters.get("instance")
        node_name = tool_parameters.get("nodeName")
        container_id = tool_parameters.get("containerId")
        pid = tool_parameters.get("pid")
        trace_id = tool_parameters.get("traceId")
        page_num = tool_parameters.get("pageNum")
        page_size = tool_parameters.get("pageSize")

        params = {}
        if service:
            params["service"] = [service]
        if start_time:
            params["startTime"] = start_time
        if end_time:
            params["endTime"] = end_time
        if namespace:
            params["namespace"] = [namespace]
        if endpoint:
            params["endpoint"] = endpoint
        if instance:
            params["instance"] = instance
        if node_name:
            params["nodeName"] = node_name
        if container_id:
            params["containerId"] = container_id
        if pid:
            params["pid"] = pid
        if trace_id:
            params["traceId"] = trace_id
        if page_num:
            params["pageNum"] = page_num
        if page_size:
            params["pageSize"] = page_size
        
        content_url = dify_config.APO_BACKEND_URL + "/api/trace/pagelist"
        content = requests.post(content_url, json=params).json()
        list = json.dumps({
            'type': 'trace',
            'display': True,
            'data': content,
        })
        yield self.create_text_message(list)