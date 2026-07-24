from collections.abc import Generator
from datetime import UTC, datetime
from typing import Any, override

from pytz import timezone as pytz_timezone  # type: ignore[import-untyped]
from sqlalchemy.orm import Session

from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.entities.ui_entities import A2UI_CATALOG_ID, A2UI_PROTOCOL_VERSION

_CURRENT_TIME_SURFACE_ID = "current-time"


class CurrentTimeTool(BuiltinTool):
    @override
    def _invoke(
        self,
        session: Session,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        """Return the formatted time for the model and a standard time card for chat clients.

        Invalid timezone values retain the existing text-only error response.
        """
        timezone_name = tool_parameters.get("timezone", "UTC")
        fm = tool_parameters.get("format") or "%Y-%m-%d %H:%M:%S %Z"
        if timezone_name == "UTC":
            current_time = datetime.now(UTC)
        else:
            try:
                timezone_info = pytz_timezone(timezone_name)
            except Exception:
                yield self.create_text_message(f"Invalid timezone: {timezone_name}")
                return
            current_time = datetime.now(timezone_info)

        formatted_time = current_time.strftime(fm)
        yield self.create_text_message(formatted_time)
        yield self.create_ui_message(
            {
                "messages": [
                    {
                        "version": A2UI_PROTOCOL_VERSION,
                        "createSurface": {
                            "surfaceId": _CURRENT_TIME_SURFACE_ID,
                            "catalogId": A2UI_CATALOG_ID,
                        },
                    },
                    {
                        "version": A2UI_PROTOCOL_VERSION,
                        "updateDataModel": {
                            "surfaceId": _CURRENT_TIME_SURFACE_ID,
                            "value": {"currentTime": current_time.isoformat()},
                        },
                    },
                    {
                        "version": A2UI_PROTOCOL_VERSION,
                        "updateComponents": {
                            "surfaceId": _CURRENT_TIME_SURFACE_ID,
                            "components": [
                                {
                                    "id": "root",
                                    "component": "Card",
                                    "children": ["time"],
                                },
                                {
                                    "id": "time",
                                    "component": "DateTime",
                                    "value": {"path": "/currentTime"},
                                    "format": "datetime",
                                },
                            ],
                        },
                    },
                ],
            }
        )
