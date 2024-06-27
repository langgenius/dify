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

        if 'api_key' in self.runtime.credentials and self.runtime.credentials.get('api_key'):
            headers['Authorization'] = "Bearer " + self.runtime.credentials.get('api_key')

        target_selector = tool_parameters.get('target_selector')
        if target_selector is not None and target_selector != '':
            headers['X-Target-Selector'] = target_selector

        wait_for_selector = tool_parameters.get('wait_for_selector')
        if wait_for_selector is not None and wait_for_selector != '':
            headers['X-Wait-For-Selector'] = wait_for_selector

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
            str(URL(self._jina_reader_endpoint + url)),
            headers=headers,
            timeout=(10, 60)
        )

        if tool_parameters.get('summary', False):
            return self.create_text_message(self.summary(user_id, response.text))

        return self.create_text_message(response.text)
