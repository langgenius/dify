from typing import Any

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.utils.lark_api_utils import LarkRequest


class ReadRowsTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage:
        app_id = self.runtime.credentials.get("app_id")
        app_secret = self.runtime.credentials.get("app_secret")
        client = LarkRequest(app_id, app_secret)

        spreadsheet_token = tool_parameters.get("spreadsheet_token")
        sheet_id = tool_parameters.get("sheet_id")
        sheet_name = tool_parameters.get("sheet_name")
        start_row = tool_parameters.get("start_row")
        num_rows = tool_parameters.get("num_rows")
        user_id_type = tool_parameters.get("user_id_type", "open_id")

        res = client.read_rows(spreadsheet_token, sheet_id, sheet_name, start_row, num_rows, user_id_type)

        return self.create_json_message(res)
