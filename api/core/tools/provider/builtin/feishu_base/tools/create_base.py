from typing import Any

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool

from .feishu_api import FeishuRequest


class CreateBaseTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage:
        name = tool_parameters.get('name', '')
        app_id = self.runtime.credentials.get('app_id')
        app_secret = self.runtime.credentials.get('app_secret')
        res = FeishuRequest(app_id, app_secret).create_base(name)
        return self.create_json_message(res)
