from typing import Any, Union
import httpx

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class CloudflareKVGet(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        Invoke tool to get a value from Cloudflare KV by key
        """
        key_name = tool_parameters.get('key_name')
        namespace_id = tool_parameters.get('namespace_id')

        account_id = self.runtime.credentials.get('account_id')
        auth_bearer = self.runtime.credentials.get('api_token')

        url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/storage/kv/namespaces/{namespace_id}/values/{key_name}"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {auth_bearer}"
        }
        try:
            with httpx.Client() as client:
                response = client.get(url, headers=headers)
            text = response.text
        except Exception as e:
            text = f"error: {e}"
        return self.create_text_message(text)
