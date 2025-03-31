import json
from collections.abc import Generator
from typing import Any, Optional

import requests

from configs import dify_config
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage


class QuerySpanTool(BuiltinTool):
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
        node_name = tool_parameters.get("nodeName")
        pid = tool_parameters.get("pid")

        params = {
            'startTime': start_time,
            'endTime': end_time,
            'nodeName': node_name,
            'pid': pid
        }
        
        content_url = dify_config.APO_BACKEND_URL + "/api/trace/onoffcpu"
        response = requests.get(
            content_url,
            params=params,
        ).json()
        list = json.dumps({
            'type': 'span',
            'display': True,
            'data': response,
        })
        yield self.create_text_message(list)