import json
from collections.abc import Generator
from typing import Any, Optional

import requests

from configs import dify_config
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage


class QueryTraceInfoTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        trace_id = tool_parameters.get("traceId")

        params = {
            'traceId': trace_id,
        }
        
        content_url = dify_config.APO_BACKEND_URL + "/api/trace/info"
        response = requests.get(
            content_url,
            params=params 
        ).json()

        result = json.dumps({
            'type': 'trace',
            'display': True,
            'data': response,
        })
        yield self.create_text_message(result)
