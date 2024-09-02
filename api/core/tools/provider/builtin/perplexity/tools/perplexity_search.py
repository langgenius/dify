import json
from typing import Any, Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool

PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions"

class PerplexityAITool(BuiltinTool):
    def _parse_response(self, response: dict) -> dict:
        """Parse the response from Perplexity AI API"""
        if 'choices' in response and len(response['choices']) > 0:
            message = response['choices'][0]['message']
            return {
                'content': message.get('content', ''),
                'role': message.get('role', ''),
                'citations': response.get('citations', [])
            }
        else:
            return {'content': 'Unable to get a valid response', 'role': 'assistant', 'citations': []}

    def _invoke(self,
                user_id: str,
                tool_parameters: dict[str, Any],
                ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        headers = {
            "Authorization": f"Bearer {self.runtime.credentials['perplexity_api_key']}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": tool_parameters.get('model', 'llama-3.1-sonar-small-128k-online'),
            "messages": [
                {
                    "role": "system",
                    "content": "Be precise and concise."
                },
                {
                    "role": "user",
                    "content": tool_parameters['query']
                }
            ],
            "max_tokens": tool_parameters.get('max_tokens', 4096),
            "temperature": tool_parameters.get('temperature', 0.7),
            "top_p": tool_parameters.get('top_p', 1),
            "top_k": tool_parameters.get('top_k', 5),
            "presence_penalty": tool_parameters.get('presence_penalty', 0),
            "frequency_penalty": tool_parameters.get('frequency_penalty', 1),
            "stream": False
        }
        
        if 'search_recency_filter' in tool_parameters:
            payload['search_recency_filter'] = tool_parameters['search_recency_filter']
        if 'return_citations' in tool_parameters:
            payload['return_citations'] = tool_parameters['return_citations']
        if 'search_domain_filter' in tool_parameters:
            if isinstance(tool_parameters['search_domain_filter'], str):
                payload['search_domain_filter'] = [tool_parameters['search_domain_filter']]
            elif isinstance(tool_parameters['search_domain_filter'], list):
                payload['search_domain_filter'] = tool_parameters['search_domain_filter']
        

        response = requests.post(url=PERPLEXITY_API_URL, json=payload, headers=headers)
        response.raise_for_status()
        valuable_res = self._parse_response(response.json())
        
        return [
            self.create_json_message(valuable_res),
            self.create_text_message(json.dumps(valuable_res, ensure_ascii=False, indent=2))
        ]
