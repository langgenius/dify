from typing import Any, Union

from yarl import URL

from core.helper import ssrf_proxy
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class JinaSearchTool(BuiltinTool):
    _jina_search_endpoint = 'https://s.jina.ai/'

    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        query = tool_parameters['query']

        headers = {
            'Accept': 'application/json'
        }

        response = ssrf_proxy.get(
            str(URL(self._jina_search_endpoint + query)),
            headers=headers,
            timeout=(10, 60)
        )

        return self.create_text_message(response.text)
