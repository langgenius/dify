from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage

from typing import Any, Dict, List, Union
from os import path
from requests import get

class BingSearchTool(BuiltinTool):
    url = 'https://api.bing.microsoft.com/v7.0/search'

    def _invoke(self, 
                user_id: str,
               tool_parameters: Dict[str, Any], 
        ) -> Union[ToolInvokeMessage, List[ToolInvokeMessage]]:
        """
            invoke tools
        """

        key = self.runtime.credentials.get('subscription_key', None)
        if not key:
            raise Exception('subscription_key is required')
        
        server_url = self.runtime.credentials.get('server_url', None)
        if not server_url:
            server_url = self.url
        
        query = tool_parameters.get('query', None)
        if not query:
            raise Exception('query is required')
        
        market = tool_parameters.get('market', 'US')
        lang = tool_parameters.get('language', 'en')

        market_code = f'{lang}-{market}'
        accept_language = f'{lang},{market_code};q=0.9'
        headers = {
            'Ocp-Apim-Subscription-Key': key,
            'Accept-Language': accept_language
        }

        params = {
            'q': query,
            'mkt': market_code
        }

        response = get(server_url, headers=headers, params=params)

        if response.status_code != 200:
            raise Exception(f'Error {response.status_code}: {response.text}')
        
        response = response.json()
        # get the first 5 results
        search_results = response['webPages']['value'][:5]
        results = []
        for result in search_results:
            results.append(self.create_text_message(
                text=f'{result["name"]}: {result["url"]}'
            ))

        return results
        