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

        if tool_parameters.get('image_caption', False):
            headers['X-With-Generated-Alt'] = 'true'

        if tool_parameters.get('gather_all_links_at_the_end', False):
            headers['X-With-Links-Summary'] = 'true'

        if tool_parameters.get('gather_all_images_at_the_end', False):
            headers['X-With-Images-Summary'] = 'true'

        proxy_server = tool_parameters.get('proxy_server')
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
