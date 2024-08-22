from typing import Any, Dict, List, Union

import requests

from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage


class SendGroupMsg(BuiltinTool):
    """OneBot v11 Tool: Send Group Message"""

    def _invoke(
            self,
            user_id: str,
            tool_parameters: Dict[str, Any]
        ) -> Union[ToolInvokeMessage, List[ToolInvokeMessage]]:

        # Get parameters
        send_group_id = tool_parameters.get('group_id', '')
        
        message = tool_parameters.get('message', '')
        if not message:
            raise ValueError('Message is empty.')
        
        auto_escape = tool_parameters.get('auto_escape', False)

        resp = requests.post(
            f'{self.runtime.credentials['ob11_http_url']}/send_group_msg',
            json={
                'group_id': send_group_id,
                'message': message,
                'auto_escape': auto_escape
            },
            headers={
                'Authorization': 'Bearer ' + self.runtime.credentials['access_token']
            }
        )

        if resp.status_code != 200:
            raise ValueError(f'Failed to send group message: {resp.text}')
        
        return self.create_json_message(
            resp.json()
        )