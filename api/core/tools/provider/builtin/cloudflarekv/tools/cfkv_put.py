from typing import Any, Union

import httpx

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class CloudflareKVPut(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        Invoke tool to put a key-value pair in Cloudflare KV
        """
        key = tool_parameters.get('key')
        value = tool_parameters.get('value')
        namespace_id = tool_parameters.get('namespace_id')

        account_id = self.runtime.credentials.get('account_id')
        auth_bearer = self.runtime.credentials.get('api_token')

        url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/storage/kv/namespaces/{namespace_id}/bulk"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {auth_bearer}"
        }
        payload = [{"key": key, "value": value, "base64": False}]

        try:
            with httpx.Client() as client:
                response = client.put(url, json=payload, headers=headers)
            response.raise_for_status()
            text = response.text
        except Exception as e:
            text = f"error: {e}"
        return self.create_text_message(text)
