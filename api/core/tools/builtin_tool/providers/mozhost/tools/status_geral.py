from collections.abc import Generator
from typing import Any

import requests

from core.tools.builtin_tool.tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage


class StatusGeralTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        """
        Get general platform status
        """
        api_token = self.runtime.credentials.get('api_token', '')
        
        headers = {
            'Authorization': f'Bearer {api_token}',
            'Content-Type': 'application/json'
        }
        
        try:
            response = requests.get(
                'https://api.mozhost.topaziocoin.online/api/alexa/status-geral',
                headers=headers,
                timeout=30
            )
            response.raise_for_status()
            
            yield self.create_json_message(response.json())
        except Exception as e:
            yield self.create_text_message(f'Failed to get platform status: {str(e)}')
