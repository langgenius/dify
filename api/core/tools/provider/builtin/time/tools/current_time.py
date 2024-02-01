from datetime import datetime, timezone
from typing import Any, Dict, List, Union

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool
from pytz import timezone as pytz_timezone


class CurrentTimeTool(BuiltinTool):
    def _invoke(self, 
                user_id: str,
               tool_parameters: Dict[str, Any], 
        ) -> Union[ToolInvokeMessage, List[ToolInvokeMessage]]:
        """
            invoke tools
        """
        # get timezone
        tz = tool_parameters.get('timezone', 'UTC')
        if tz == 'UTC':
            return self.create_text_message(f'{datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S %Z")}')

        try:
            tz = pytz_timezone(tz)
        except:
            return self.create_text_message(f'Invalid timezone: {tz}')
        return self.create_text_message(f'{datetime.now(tz).strftime("%Y-%m-%d %H:%M:%S %Z")}')