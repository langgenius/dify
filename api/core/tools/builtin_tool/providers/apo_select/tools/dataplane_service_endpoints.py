import json
from collections.abc import Generator
from typing import Any, Optional, Dict

import requests

from configs import dify_config
from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from libs.apo_utils import APOUtils


class ServiceEndpointsTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: Dict[str, Any],
        conversation_id: Optional[str] = None,
        app_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        service = tool_parameters.get('service')
        cluster = tool_parameters.get('cluster')
        start_time = tool_parameters.get('startTime')
        end_time = tool_parameters.get('endTime')

        query_params = {
            "service": service,
            "cluster": cluster,
            "startTime": start_time,
            "endTime": end_time,
        }

        try:
            response = requests.get(
                f"{dify_config.APO_BACKEND_URL}/api/dataplane/endpoints",
                params=query_params,
                timeout=10,
            )
            response.raise_for_status()

            result = response.json().get("results", [])

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

