import json
from typing import Any, Union

import httpx

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class ListBaseRecordsTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        url = "https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records/search"

        access_token = tool_parameters.get("Authorization", "")
        if not access_token:
            return self.create_text_message("Invalid parameter access_token")

        app_token = tool_parameters.get("app_token", "")
        if not app_token:
            return self.create_text_message("Invalid parameter app_token")

        table_id = tool_parameters.get("table_id", "")
        if not table_id:
            return self.create_text_message("Invalid parameter table_id")

        page_token = tool_parameters.get("page_token", "")
        page_size = tool_parameters.get("page_size", "")
        sort_condition = tool_parameters.get("sort_condition", "")
        filter_condition = tool_parameters.get("filter_condition", "")

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {access_token}",
        }

        params = {
            "page_token": page_token,
            "page_size": page_size,
        }

        payload = {"automatic_fields": True}
        if sort_condition:
            payload["sort"] = json.loads(sort_condition)
        if filter_condition:
            payload["filter"] = json.loads(filter_condition)

        try:
            res = httpx.post(
                url.format(app_token=app_token, table_id=table_id),
                headers=headers,
                params=params,
                json=payload,
                timeout=30,
            )
            res_json = res.json()
            if res.is_success:
                return self.create_text_message(text=json.dumps(res_json))
            else:
                return self.create_text_message(
                    f"Failed to list base records, status code: {res.status_code}, response: {res.text}"
                )
        except Exception as e:
            return self.create_text_message("Failed to list base records. {}".format(e))
