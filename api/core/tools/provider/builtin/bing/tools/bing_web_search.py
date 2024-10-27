from typing import Any, Union
from urllib.parse import quote

from requests import get

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class BingSearchTool(BuiltinTool):
    url: str = 'https://api.bing.microsoft.com/v7.0/search'

    def _invoke_bing(self, 
                     user_id: str,
                     server_url: str,
                     subscription_key: str, query: str, limit: int, 
                     result_type: str, market: str, lang: str, 
                     filters: list[str]) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
            invoke bing search
        """
        market_code = f'{lang}-{market}'
        accept_language = f'{lang},{market_code};q=0.9'
        headers = {
            'Ocp-Apim-Subscription-Key': subscription_key,
            'Accept-Language': accept_language
        }

        query = quote(query)
        server_url = f'{server_url}?q={query}&mkt={market_code}&count={limit}&responseFilter={",".join(filters)}'
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
                    url = f': {result["url"]}' if "url" in result else ""
                    results.append(self.create_text_message(
                        text=f'{result["name"]}{url}'
                    ))


            if entities:
                for entity in entities:
                    url = f': {entity["url"]}' if "url" in entity else ""
                    results.append(self.create_text_message(
                        text=f'{entity.get("name", "")}{url}'
                    ))

            if news:
                for news_item in news:
                    url = f': {news_item["url"]}' if "url" in news_item else ""
                    results.append(self.create_text_message(
                        text=f'{news_item.get("name", "")}{url}'
                    ))

            if related_searches:
                for related in related_searches:
                    url = f': {related["displayText"]}' if "displayText" in related else ""
                    results.append(self.create_text_message(
                        text=f'{related.get("displayText", "")}{url}'
                    ))
                    
            return results
        else:
            # construct text
            text = ''
            if search_results:
                for i, result in enumerate(search_results):
                    text += f'{i+1}: {result.get("name", "")} - {result.get("snippet", "")}\n'

            if computation and 'expression' in computation and 'value' in computation:
                text += '\nComputation:\n'
                text += f'{computation["expression"]} = {computation["value"]}\n'

            if entities:
                text += '\nEntities:\n'
                for entity in entities:
                    url = f'- {entity["url"]}' if "url" in entity else ""
                    text += f'{entity.get("name", "")}{url}\n'

            if news:
                text += '\nNews:\n'
                for news_item in news:
                    url = f'- {news_item["url"]}' if "url" in news_item else ""
                    text += f'{news_item.get("name", "")}{url}\n'

            if related_searches:
                text += '\n\nRelated Searches:\n'
                for related in related_searches:
                    url = f'- {related["webSearchUrl"]}' if "webSearchUrl" in related else ""
                    text += f'{related.get("displayText", "")}{url}\n'

            return self.create_text_message(text=self.summary(user_id=user_id, content=text))
        

    def validate_credentials(self, credentials: dict[str, Any], tool_parameters: dict[str, Any]) -> None:
        key = credentials.get('subscription_key')
        if not key:
            raise Exception('subscription_key is required')
        
        server_url = credentials.get('server_url')
        if not server_url:
            server_url = self.url

        query = tool_parameters.get('query')
        if not query:
            raise Exception('query is required')
        
        limit = min(tool_parameters.get('limit', 5), 10)
        result_type = tool_parameters.get('result_type', 'text') or 'text'

        market = tool_parameters.get('market', 'US')
        lang = tool_parameters.get('language', 'en')
        filter = []

        if credentials.get('allow_entities', False):
            filter.append('Entities')

        if credentials.get('allow_computation', False):
            filter.append('Computation')

        if credentials.get('allow_news', False):
            filter.append('News')

        if credentials.get('allow_related_searches', False):
            filter.append('RelatedSearches')

        if credentials.get('allow_web_pages', False):
            filter.append('WebPages')

        if not filter:
            raise Exception('At least one filter is required')
        
        self._invoke_bing(
            user_id='test',
            server_url=server_url,
            subscription_key=key,
            query=query,
            limit=limit,
            result_type=result_type,
            market=market,
            lang=lang,
            filters=filter
        )
        
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
        
        query = tool_parameters.get('query')
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

        if not filter:
            raise Exception('At least one filter is required')
        
        return self._invoke_bing(
            user_id=user_id,
            server_url=server_url,
            subscription_key=key,
            query=query,
            limit=limit,
            result_type=result_type,
            market=market,
            lang=lang,
            filters=filter
        )