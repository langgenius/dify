from typing import Any, Dict, List, Union

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolInvokeError
from core.tools.tool.builtin_tool import BuiltinTool


class WebscraperTool(BuiltinTool):
    def _invoke(self,
               user_id: str,
               tool_parameters: Dict[str, Any], 
        ) -> Union[ToolInvokeMessage, List[ToolInvokeMessage]]:
        """
            invoke tools
        """
        try:
            url = tool_parameters.get('url', '')
            user_agent = tool_parameters.get('user_agent', '')
            if not url:
                return self.create_text_message('Please input url')
            
            # get webpage
            result = self.get_url(url, user_agent=user_agent)

            # summarize and return
            return self.create_text_message(self.summary(user_id=user_id, content=result))
        except Exception as e:
            raise ToolInvokeError(str(e))
        