import json
from typing import Any, Union

import httpx

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class DeleteBaseTablesTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]
                ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:

        url = "https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/batch_delete"

        access_token = tool_parameters.get('Authorization', '')
        if not access_token:
            return self.create_text_message('Invalid parameter access_token')

        app_token = tool_parameters.get('app_token', '')
        if not app_token:
            return self.create_text_message('Invalid parameter app_token')

        table_ids = tool_parameters.get('table_ids', '')
        if not table_ids:
            return self.create_text_message('Invalid parameter table_ids')

        headers = {
            'Content-Type': 'application/json',
            'Authorization': f"Bearer {access_token}",
        }

        params = {}
        payload = {
            "table_ids": json.loads(table_ids)
        }

        try:
            res = httpx.post(url.format(app_token=app_token), headers=headers, params=params, json=payload, timeout=30)
            res_json = res.json()
            if res.is_success:
                return self.create_text_message(text=json.dumps(res_json))
            else:
                return self.create_text_message(
                    f"Failed to delete base tables, status code: {res.status_code}, response: {res.text}")
        except Exception as e:
            return self.create_text_message("Failed to delete base tables. {}".format(e))
