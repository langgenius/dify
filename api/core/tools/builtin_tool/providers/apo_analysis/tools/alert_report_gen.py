import json
import requests
from collections.abc import Generator
from typing import Any, Optional

from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from configs import dify_config

class AlertReportGen(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        reportType = tool_parameters.get("reportType")
        errormsgs = []

        overview = convert_to_json(tool_parameters.get("overview"), "overview", errormsgs)
        tags = convert_to_json(tool_parameters.get("tags"), "tags", errormsgs)
        topology = convert_to_json(tool_parameters.get("topology"), "topology", errormsgs)
        rootCauseAnalysis = convert_to_json(tool_parameters.get("rootCauseAnalysis"), "rootCauseAnalysis", errormsgs)
        suggest = convert_to_json(tool_parameters.get("suggest"), "suggest", errormsgs).get("suggest", {})
        evidence = convert_to_json(tool_parameters.get("evidence"), "evidence", errormsgs).get("evidence", {})
        json_data = {
            'reportType': reportType,
            'overview': overview,
            'tags': tags,
            'topology': topology,
            'rootCauseAnalysis': rootCauseAnalysis,
            'suggest': suggest,
            'evidence': evidence
        }
        resp = requests.post(dify_config.APO_BACKEND_URL + '/api/alerts/events/report/add', json=json_data)
        if resp.status_code != 200:
            errormsgs.append(f"Error while creating report, msg: {resp.text}")
        list = json.dumps({
            'type': 'report',
            'display': False,
            'msg': errormsgs
        })

        yield self.create_text_message(list)


def convert_to_json(data, name: str, errormsgs: list) -> dict:
    try:
        return json.loads(data)
    except:
        errormsgs.append(f'{name} Invalid JSON')
        return {}  