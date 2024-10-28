from typing import Any, Union

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.provider.builtin.aliyuque.tools.base import AliYuqueTool
from core.tools.tool.builtin_tool import BuiltinTool


class AliYuqueDescribeBookIndexPageTool(AliYuqueTool, BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        token = self.runtime.credentials.get("token", None)
        if not token:
            raise Exception("token is required")
        return self.create_text_message(
            self.request("GET", token, tool_parameters, "/api/v2/repos/{group_login}/{book_slug}/index_page")
        )
