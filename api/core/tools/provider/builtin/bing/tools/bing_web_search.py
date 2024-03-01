from typing import Any, Union
from urllib.parse import quote

from requests import get

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class BingSearchTool(BuiltinTool):
    url = 'https://api.bing.microsoft.com/v7.0/search'

    def _invoke(self, 
                user_id: str,
               tool_parameters: dict[str, Any], 
        ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
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
        
        limit = min(tool_parameters.get('limit', 5), 10)
        result_type = tool_parameters.get('result_type', 'text') or 'text'
        
        market = tool_parameters.get('market', 'US')
        lang = tool_parameters.get('language', 'en')
        filter = []

        if tool_parameters.get('enable_computation', False):
            filter.append('Computation')
        if tool_parameters.get('enable_entities', False):
            filter.append('Entities')
        if tool_parameters.get('enable_news', False):
            filter.append('News')
        if tool_parameters.get('enable_related_search', False):
            filter.append('RelatedSearches')
        if tool_parameters.get('enable_webpages', False):
            filter.append('WebPages')

        market_code = f'{lang}-{market}'
        accept_language = f'{lang},{market_code};q=0.9'
        headers = {
            'Ocp-Apim-Subscription-Key': key,
            'Accept-Language': accept_language
        }

        query = quote(query)
        server_url = f'{server_url}?q={query}&mkt={market_code}&count={limit}&responseFilter={",".join(filter)}'
        response = get(server_url, headers=headers)

        if response.status_code != 200:
            raise Exception(f'Error {response.status_code}: {response.text}')
        
        response = response.json()
        search_results = response['webPages']['value'][:limit] if 'webPages' in response else []
        related_searches = response['relatedSearches']['value'] if 'relatedSearches' in response else []
        entities = response['entities']['value'] if 'entities' in response else []
        news = response['news']['value'] if 'news' in response else []
        computation = response['computation']['value'] if 'computation' in response else None

        if result_type == 'link':
            results = []
            if search_results:
                for result in search_results:
                    results.append(self.create_text_message(
                        text=f'{result["name"]}: {result["url"]}'
                    ))


            if entities:
                for entity in entities:
                    results.append(self.create_text_message(
                        text=f'{entity["name"]}: {entity["url"]}'
                    ))

            if news:
                for news_item in news:
                    results.append(self.create_text_message(
                        text=f'{news_item["name"]}: {news_item["url"]}'
                    ))

            if related_searches:
                for related in related_searches:
                    results.append(self.create_text_message(
                        text=f'{related["displayText"]}: {related["webSearchUrl"]}'
                    ))
                    
            return results
        else:
            # construct text
            text = ''
            if search_results:
                for i, result in enumerate(search_results):
                    text += f'{i+1}: {result["name"]} - {result["snippet"]}\n'

            if computation and 'expression' in computation and 'value' in computation:
                text += '\nComputation:\n'
                text += f'{computation["expression"]} = {computation["value"]}\n'

            if entities:
                text += '\nEntities:\n'
                for entity in entities:
                    text += f'{entity["name"]} - {entity["url"]}\n'

            if news:
                text += '\nNews:\n'
                for news_item in news:
                    text += f'{news_item["name"]} - {news_item["url"]}\n'

            if related_searches:
                text += '\n\nRelated Searches:\n'
                for related in related_searches:
                    text += f'{related["displayText"]} - {related["webSearchUrl"]}\n'

            return self.create_text_message(text=self.summary(user_id=user_id, content=text))
