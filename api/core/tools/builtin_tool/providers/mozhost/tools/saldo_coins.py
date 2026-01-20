from collections.abc import Generator
from typing import Any

import requests

from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage


class SaldoCoinsTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        """
        Get user coins balance
        """
        api_token = self.runtime.credentials.get('api_token', '')
        query_user_id = tool_parameters.get('user_id', '')
        
        headers = {
            'Authorization': f'Bearer {api_token}',
            'Content-Type': 'application/json'
        }
        
        params = {
            'user_id': query_user_id
        }
        
        try:
            response = requests.get(
                'https://api.mozhost.topaziocoin.online/api/alexa/saldo-coins',
                headers=headers,
                params=params,
                timeout=30
            )
            response.raise_for_status()
            
            yield self.create_json_message(response.json())
        except Exception as e:
            yield self.create_text_message(f'Failed to get coins balance: {str(e)}')
