from typing import Any, Union

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolParameterValidationError
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.utils.alist_api_utils import AListRequest


class ListFileTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        alist_base_url = self.runtime.credentials.get("alist_base_url")
        username = tool_parameters.get("username")
        password = tool_parameters.get("password")
        path = tool_parameters.get("path")
        page = tool_parameters.get("page", 1)
        page_size = tool_parameters.get("page_size", 500)
        if page_size > 500:
            raise ToolParameterValidationError("page_size must be less than 500")
        client = AListRequest(alist_base_url, username, password)

        res = client.list_file(path, page, page_size)
        return self.create_json_message(res)
