from typing import Any, Union

from yarl import URL

from core.helper import ssrf_proxy
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class JinaReaderTool(BuiltinTool):
    _jina_reader_endpoint = 'https://r.jina.ai/'

    def _invoke(self, 
                user_id: str,
               tool_parameters: dict[str, Any], 
        ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
            invoke tools
        """
        url = tool_parameters['url']

        headers = {
            'Accept': 'application/json'
        }

        response = ssrf_proxy.get(
            str(URL(self._jina_reader_endpoint + url)), 
            headers=headers,
            timeout=(10, 60)
        )

        if tool_parameters.get('summary', False):
            return self.create_text_message(self.summary(user_id, response.text))
        
        return self.create_text_message(response.text)
