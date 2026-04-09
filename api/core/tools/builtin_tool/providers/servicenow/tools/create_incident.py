from collections.abc import Generator
from typing import Any

from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolInvokeError

from .._client import ServiceNowClient


class ServiceNowCreateIncidentTool(BuiltinTool):
    _ALLOWED_FIELDS = (
        "short_description",
        "description",
        "category",
        "subcategory",
        "urgency",
        "impact",
        "caller_id",
        "assignment_group",
    )

    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        client = ServiceNowClient(self.runtime.credentials or {})

        payload: dict[str, Any] = {}
        for field in self._ALLOWED_FIELDS:
            value = tool_parameters.get(field)
            if value is not None and value != "":
                payload[field] = value

        if not payload.get("short_description"):
            raise ToolInvokeError("`short_description` is required to create a ServiceNow incident.")

        incident = client.create_incident(payload)
        yield self.create_json_message({"incident": incident})
