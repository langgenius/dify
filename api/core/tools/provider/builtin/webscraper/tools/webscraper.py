from core.tools.provider.tool_provider import Tool
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolInvokeError
from core.tools.provider.builtin.webscraper.tools.web_reader_tool import get_url
from core.model_runtime.entities.message_entities import PromptMessage

from typing import Any, Dict, List, Union

class WebscraperTool(Tool):
    def _invoke(self, 
               tool_paramters: Dict[str, Any], 
               credentials: Dict[str, Any], 
               prompt_messages: List[PromptMessage]
        ) -> Union[ToolInvokeMessage, List[ToolInvokeMessage]]:
        """
            invoke tools
        """
        try:
            url = tool_paramters.get('url', '')
            user_agent = tool_paramters.get('user_agent', '')
            if not url:
                return self.create_text_message('Please input url')
            
            result = get_url(url, user_agent=user_agent)

            return self.create_text_message(result)
        except Exception as e:
            raise ToolInvokeError(str(e))
    
    def validate_credentials(self, credentails: Dict[str, Any], parameters: Dict[str, Any]) -> None:
        pass