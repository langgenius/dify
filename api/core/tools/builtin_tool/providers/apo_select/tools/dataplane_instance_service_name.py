import json
from collections.abc import Generator
from typing import Any, Optional, Dict

import requests

from configs import dify_config
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from libs.apo_utils import APOUtils


class InstanceServiceTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: Dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        pod = tool_parameters.get('pod')
        container_id = tool_parameters.get('containerId')
        pid = tool_parameters.get('pid')
        node = tool_parameters.get('node')
        start_time = tool_parameters.get('startTime')
        end_time = tool_parameters.get('endTime')
        cluster = tool_parameters.get('cluster', '')
        try:
            request_body = {
                "cluster": cluster,
                "endTime": end_time,
                "startTime": start_time,
                "tags": {
                    "containerId": container_id or '',
                    "nodeName": node or '',
                    "pid": pid or '',
                    "pod": pod or ''
                }
            }

            response = requests.post(
                f"{dify_config.APO_BACKEND_URL}/api/dataplane/servicename",
                json=request_body,
                timeout=10,
            )
            response.raise_for_status()

            result = response.json().get("result", {})

            formatted_data = json.dumps(
                {
                    "type": "list",
                    "display": True,
                    "data": result,
                },
                indent=2,
            )
            yield self.create_text_message(formatted_data)

        except requests.RequestException as e:
            yield self.create_text_message(json.dumps({"error" : f"Error: Failed to fetch data from API. {str(e)}"}))
        except json.JSONDecodeError:
            yield self.create_text_message(json.dumps({"error": "Error: Invalid JSON response from API."}))
        except Exception as e:
            yield self.create_text_message(json.dumps({"error": f"Error: An unexpected error occurred. {str(e)}"}))