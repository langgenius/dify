import json
from typing import Any, Union

import httpx

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class UpdateBaseRecordTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]
                ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:

        url = "https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records/{record_id}"

        access_token = tool_parameters.get('Authorization', '')
        if not access_token:
            return self.create_text_message('Invalid parameter access_token')

        app_token = tool_parameters.get('app_token', '')
        if not app_token:
            return self.create_text_message('Invalid parameter app_token')

        table_id = tool_parameters.get('table_id', '')
        if not table_id:
            return self.create_text_message('Invalid parameter table_id')

        record_id = tool_parameters.get('record_id', '')
        if not record_id:
            return self.create_text_message('Invalid parameter record_id')

        fields = tool_parameters.get('fields', '')
        if not fields:
            return self.create_text_message('Invalid parameter fields')

        headers = {
            'Content-Type': 'application/json',
            'Authorization': f"Bearer {access_token}",
        }

        params = {}
        payload = {
            "fields": json.loads(fields)
        }

        try:
            res = httpx.put(url.format(app_token=app_token, table_id=table_id, record_id=record_id), headers=headers,
                            params=params, json=payload, timeout=30)
            res_json = res.json()
            if res.is_success:
                return self.create_text_message(text=json.dumps(res_json))
            else:
                return self.create_text_message(
                    f"Failed to update base record, status code: {res.status_code}, response: {res.text}")
        except Exception as e:
            return self.create_text_message("Failed to update base record. {}".format(e))
