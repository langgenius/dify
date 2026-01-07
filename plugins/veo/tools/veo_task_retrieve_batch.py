from __future__ import annotations

from collections.abc import Generator
from typing import Any

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from tools.acedata_client import AceDataVeoClient, AceDataVeoError, parse_task_ids


class VeoTaskRetrieveBatchTool(Tool):
    def _invoke(
        self, tool_parameters: dict[str, Any]
    ) -> Generator[ToolInvokeMessage, None, None]:
        task_ids = parse_task_ids(tool_parameters.get("task_ids"))
        if not task_ids:
            raise ValueError("`task_ids` must contain at least 1 item.")

        client = AceDataVeoClient(
            bearer_token=str(self.runtime.credentials["acedata_bearer_token"])
        )
        try:
            result = client.retrieve_tasks(task_ids=task_ids, timeout_s=60)
        except AceDataVeoError as e:
            yield self.create_variable_message("success", False)
            yield self.create_variable_message("error", {"code": e.code, "message": e.message})
            return

        yield self.create_variable_message("success", True)
        yield self.create_variable_message("data", result)
