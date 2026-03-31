from collections.abc import Generator
from typing import Any

from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolInvokeError

from .._client import ServiceNowClient


class ServiceNowGetIncidentTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        identifier = str(tool_parameters.get("incident_number_or_sys_id", "")).strip()
        if not identifier:
            raise ToolInvokeError("`incident_number_or_sys_id` is required.")

        client = ServiceNowClient(self.runtime.credentials or {})
        incident = client.get_incident(identifier)
        yield self.create_json_message({"incident": incident})
