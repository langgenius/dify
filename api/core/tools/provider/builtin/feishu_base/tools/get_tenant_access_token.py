import json
from typing import Any, Union

import httpx

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class GetTenantAccessTokenTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]
                ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:

        url = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"

        app_id = tool_parameters.get('app_id', '')
        if not app_id:
            return self.create_text_message('Invalid parameter app_id')

        app_secret = tool_parameters.get('app_secret', '')
        if not app_secret:
            return self.create_text_message('Invalid parameter app_secret')

        headers = {
            'Content-Type': 'application/json',
        }
        params = {}
        payload = {
            "app_id": app_id,
            "app_secret": app_secret
        }

        """
        {
            "code": 0,
            "msg": "ok",
            "tenant_access_token": "t-caecc734c2e3328a62489fe0648c4b98779515d3",
            "expire": 7200
        }
        """
        try:
            res = httpx.post(url, headers=headers, params=params, json=payload, timeout=30)
            res_json = res.json()
            if res.is_success:
                return self.create_text_message(text=json.dumps(res_json))
            else:
                return self.create_text_message(
                    f"Failed to get tenant access token, status code: {res.status_code}, response: {res.text}")
        except Exception as e:
            return self.create_text_message("Failed to get tenant access token. {}".format(e))
