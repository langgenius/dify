from typing import Any

from core.helper import ssrf_proxy
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class JinaTokenizerTool(BuiltinTool):
    _jina_tokenizer_endpoint = 'https://tokenize.jina.ai/'

    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> ToolInvokeMessage:
        content = tool_parameters['content']
        body = {
            "content": content
        }

        headers = {
            'Content-Type': 'application/json'
        }

        if 'api_key' in self.runtime.credentials and self.runtime.credentials.get('api_key'):
            headers['Authorization'] = "Bearer " + self.runtime.credentials.get('api_key')

        if tool_parameters.get('return_chunks', False):
            body['return_chunks'] = True
        
        if tool_parameters.get('return_tokens', False):
            body['return_tokens'] = True
        
        if tokenizer := tool_parameters.get('tokenizer'):
            body['tokenizer'] = tokenizer

        response = ssrf_proxy.post(
            self._jina_tokenizer_endpoint,
            headers=headers,
            json=body,
        )

        return self.create_json_message(response.json())
