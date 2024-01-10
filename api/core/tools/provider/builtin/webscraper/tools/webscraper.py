from core.tools.provider.builtin_tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolInvokeError
from core.tools.provider.builtin.webscraper.tools.web_reader_tool import get_url
from core.tools.model.tool_model_manager import ToolModelManager
from core.tools.model.entities import ToolModelConfig
from core.model_runtime.entities.message_entities import PromptMessage

from typing import Any, Dict, List, Union

class WebscraperTool(BuiltinTool):
    def _invoke(self,
               user_id: str,
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
            
            # get model config
            model_config = tool_paramters.get('model_config', None)
            if model_config is None:
                raise ToolInvokeError('Missing model config')
            
            try:
                tool_config = ToolModelConfig(**model_config)
            except Exception as e:
                raise ToolInvokeError('Invalid model config')
            
            ToolModelManager.invoke(

            )
            
            result = get_url(url, user_agent=user_agent)

            return self.create_text_message(result)
        except Exception as e:
            raise ToolInvokeError(str(e))
    
    def validate_credentials(self, credentails: Dict[str, Any], parameters: Dict[str, Any]) -> None:
        pass