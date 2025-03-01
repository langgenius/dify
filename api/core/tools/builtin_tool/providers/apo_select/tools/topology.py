import json
from collections.abc import Generator
from typing import Any, Optional

import requests

from configs import dify_config
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage


class TopologyTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        service = tool_parameters.get("service")
        endpoint = tool_parameters.get("endpoint")
        start_time = tool_parameters.get("start_time")
        end_time = tool_parameters.get("end_time")
        params = {
          'service': service,
          'endpoint': endpoint,
          'startTime': start_time,
          'endTime': end_time,
          'entryService': service,
          'entryEndpoint': endpoint,
          'withTopology': True,
          'removeClientCall': True,
          }
        resp = requests.get(dify_config.APO_BACKEND_URL + '/api/service/relation', params=params)
        list = resp.json()
        list = json.dumps({
            'type': 'topology',
            'display': True,
            'data': list,
        })
        yield self.create_text_message(list)