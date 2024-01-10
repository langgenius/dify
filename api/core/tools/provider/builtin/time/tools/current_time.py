from core.tools.entities.tool_entities import ToolInvokeMessage
from core.model_runtime.entities.message_entities import PromptMessage
from core.tools.provider.builtin_tool import BuiltinTool

from typing import Any, Dict, List, Union, Optional, Tuple

import datetime

class CurrentTimeTool(BuiltinTool):
    def _invoke(self, 
                user_id: str,
               tool_paramters: Dict[str, Any], 
               credentials: Dict[str, Any], 
               prompt_messages: List[PromptMessage]
        ) -> Union[ToolInvokeMessage, List[ToolInvokeMessage]]:
        """
            invoke tools
        """
        return self.create_text_message(f'{datetime.datetime.now()}')
    
    def validate_credentials(self, credentails: Dict[str, Any], parameters: Dict[str, Any]) -> None:
        pass