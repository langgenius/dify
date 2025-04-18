import json
from collections.abc import Generator
from typing import Any, Optional

import requests

from configs import dify_config
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage


class QueryFullLogsTool(BuiltinTool):
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
        query = tool_parameters.get("query")
        page_num = tool_parameters.get('pageNum', 1)
        page_size = tool_parameters.get('pageSize', 100)

        params = {
            "dataBase": "apo",
            "endTime": end_time,
            "isExternal": False,
            "pageNum" : page_num,
            "pageSize" : page_size,
            "query" : query,
            "startTime" : start_time,
            "tableName" : "raw_logs",
        }

        url = dify_config.APO_BACKEND_URL + "/api/log/query"
        resp = requests.post(
            url=url,
            json=params,
        )  

        list = json.dumps({
            'type': 'log',
            'display': True,
            'data': resp.json(),
        })
        yield self.create_text_message(list)