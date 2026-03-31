from collections.abc import Generator
from typing import Any

from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolInvokeError

from .._client import ServiceNowClient


class ServiceNowUpdateIncidentTool(BuiltinTool):
    _UPDATABLE_FIELDS = (
        "short_description",
        "description",
        "state",
        "urgency",
        "impact",
        "assignment_group",
        "assigned_to",
        "category",
        "subcategory",
    )

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

        update_payload: dict[str, Any] = {}
        for field in self._UPDATABLE_FIELDS:
            value = tool_parameters.get(field)
            if value is not None and value != "":
                update_payload[field] = value

        if not update_payload:
            raise ToolInvokeError("At least one field is required to update a ServiceNow incident.")

        client = ServiceNowClient(self.runtime.credentials or {})
        incident = client.update_incident(identifier, update_payload)
        yield self.create_json_message({"incident": incident})
