import json
import requests
from collections.abc import Generator
from typing import Any, Optional

from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from configs import dify_config

class GetAlertReportURL(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        
        alertEventId = tool_parameters.get('alertEventId')
        reportText = tool_parameters.get('reportText')
        frontPrefix = tool_parameters.get("frontPrefix", "")
        start_time = tool_parameters.get("startTime")
        end_time = tool_parameters.get("endTime")

        if frontPrefix == "":
            frontPrefix = dify_config.APO_BACKEND_URL
        
        end = int(end_time) + 1000000
        res = f'{reportText}\n{frontPrefix}/#/report?alertEventId={alertEventId}&startTime={start_time}&endTime={end}'
        yield self.create_text_message(res)