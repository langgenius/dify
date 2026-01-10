from __future__ import annotations

from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from tools.acedata_client import AceDataMidjourneyClient, AceDataMidjourneyError


class MidjourneyTranslateTool(Tool):
    def _invoke(
        self, tool_parameters: dict[str, Any]
    ) -> Generator[ToolInvokeMessage, None, None]:
        content = tool_parameters.get("content")
        if not isinstance(content, str) or not content.strip():
            raise ValueError("`content` is required.")

        payload: dict[str, Any] = {"content": content.strip()}
        application_id = tool_parameters.get("application_id")
        if isinstance(application_id, str) and application_id.strip():
            payload["application_id"] = application_id.strip()

        client = AceDataMidjourneyClient(
            bearer_token=str(self.runtime.credentials["acedata_bearer_token"])
        )

        try:
            result = client.translate(payload=payload, timeout_s=300)
        except AceDataMidjourneyError as e:
            yield self.create_variable_message("success", False)
            yield self.create_variable_message("error", {"code": e.code, "message": e.message})
            yield self.create_variable_message("trace_id", e.trace_id)
            return

        yield self.create_variable_message("success", True)
        yield self.create_variable_message("task_id", None)
        yield self.create_variable_message("trace_id", result.get("trace_id"))
        yield self.create_variable_message("data", result)
