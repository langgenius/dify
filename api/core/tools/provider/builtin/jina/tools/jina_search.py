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

        if 'api_key' in self.runtime.credentials and self.runtime.credentials.get('api_key'):
            headers['Authorization'] = "Bearer " + self.runtime.credentials.get('api_key')

        proxy_server = tool_parameters.get('proxy_server', None)
        if proxy_server is not None and proxy_server != '':
            headers['X-Proxy-Url'] = proxy_server

        if tool_parameters.get('no_cache', False):
            headers['X-No-Cache'] = 'true'

        response = ssrf_proxy.get(
            str(URL(self._jina_search_endpoint + query)),
            headers=headers,
            timeout=(10, 60)
        )

        return self.create_text_message(response.text)
