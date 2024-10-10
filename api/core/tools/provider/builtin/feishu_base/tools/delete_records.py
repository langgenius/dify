from typing import Any

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.utils.feishu_api_utils import FeishuRequest


class DeleteRecordsTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage:
        app_id = self.runtime.credentials.get("app_id")
        app_secret = self.runtime.credentials.get("app_secret")
        client = FeishuRequest(app_id, app_secret)

        app_token = tool_parameters.get("app_token")
        table_id = tool_parameters.get("table_id")
        table_name = tool_parameters.get("table_name")
        record_ids = tool_parameters.get("record_ids")

        res = client.delete_records(app_token, table_id, table_name, record_ids)
        return self.create_json_message(res)
