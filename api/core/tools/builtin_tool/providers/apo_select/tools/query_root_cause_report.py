import json
from collections.abc import Generator
from typing import Any, Optional

import requests

from configs import dify_config
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage


class QueryRootCauseReportTool(BuiltinTool):
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
        content_key = tool_parameters.get("endpoint")
        reason = tool_parameters.get("type")

        params = {
        "contentKey": content_key,
        "currentPage": 1,
        "endTime": end_time,
        "pageSize": 10,
        "reason": reason,
        "service": service,
        "startTime": start_time,
        }
        url = dify_config.APO_BACKEND_URL + '/api/alerts/anomaly-span/list'

        resp = requests.post(url, json=params)

        res_list = []

        for item in resp.json()["list"] or []:
            resurl = f"{dify_config.APO_BACKEND_URL}/#/cause/report/{item['traceId']}/{item['spanId']}?mutatedType={reason}"
            res_list.append(resurl)
            if len(res_list) == 3:
                break

        list = json.dumps({
            'type': 'report',
            'display': True,
            'data': res_list,
        })

        yield self.create_text_message(list)