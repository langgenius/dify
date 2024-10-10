from typing import Any, Union

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.utils.alist_api_utils import AListRequest


class RemoveFileTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        alist_base_url = self.runtime.credentials.get("alist_base_url")
        username = tool_parameters.get("username")
        password = tool_parameters.get("password")
        path = tool_parameters.get("path")
        client = AListRequest(alist_base_url, username, password)

        res = client.remove_file(path)
        return self.create_json_message(res)
