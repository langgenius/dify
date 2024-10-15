import json
from typing import Any, Union

import httpx

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class UpdateWorksheetRecordTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        appkey = tool_parameters.get("appkey", "")
        if not appkey:
            return self.create_text_message("Invalid parameter App Key")
        sign = tool_parameters.get("sign", "")
        if not sign:
            return self.create_text_message("Invalid parameter Sign")
        worksheet_id = tool_parameters.get("worksheet_id", "")
        if not worksheet_id:
            return self.create_text_message("Invalid parameter Worksheet ID")
        row_id = tool_parameters.get("row_id", "")
        if not row_id:
            return self.create_text_message("Invalid parameter Record Row ID")
        record_data = tool_parameters.get("record_data", "")
        if not record_data:
            return self.create_text_message("Invalid parameter Record Row Data")

        host = tool_parameters.get("host", "")
        if not host:
            host = "https://api.mingdao.com"
        elif not host.startswith(("http://", "https://")):
            return self.create_text_message("Invalid parameter Host Address")
        else:
            host = f"{host.removesuffix('/')}/api"

        url = f"{host}/v2/open/worksheet/editRow"
        headers = {"Content-Type": "application/json"}
        payload = {"appKey": appkey, "sign": sign, "worksheetId": worksheet_id, "rowId": row_id}

        try:
            payload["controls"] = json.loads(record_data)
            res = httpx.post(url, headers=headers, json=payload, timeout=60)
            res.raise_for_status()
            res_json = res.json()
            if res_json.get("error_code") != 1:
                return self.create_text_message(f"Failed to update the record. {res_json['error_msg']}")
            return self.create_text_message("Record updated successfully.")
        except httpx.RequestError as e:
            return self.create_text_message(f"Failed to update the record, request error: {e}")
        except json.JSONDecodeError as e:
            return self.create_text_message(f"Failed to parse JSON response: {e}")
        except Exception as e:
            return self.create_text_message(f"Failed to update the record, unexpected error: {e}")
