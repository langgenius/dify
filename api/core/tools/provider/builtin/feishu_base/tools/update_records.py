from typing import Any

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.utils.feishu_api_utils import FeishuRequest


class UpdateRecordsTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage:
        if not self.runtime or not self.runtime.credentials:
            raise ValueError("Runtime is not set")
        app_id = self.runtime.credentials.get("app_id")
        app_secret = self.runtime.credentials.get("app_secret")
        if not app_id or not app_secret:
            raise ValueError("app_id and app_secret are required")
        client = FeishuRequest(app_id, app_secret)

        app_token = tool_parameters.get("app_token", "")
        table_id = tool_parameters.get("table_id", "")
        table_name = tool_parameters.get("table_name", "")
        records = tool_parameters.get("records", "")
        user_id_type = tool_parameters.get("user_id_type", "open_id")

        res = client.update_records(app_token, table_id, table_name, records, user_id_type)
        return self.create_json_message(res)
