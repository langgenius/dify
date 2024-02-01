import json
from datetime import datetime
from typing import Any, Dict, List, Union
from urllib.parse import quote

import requests
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class GihubRepositoriesTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: Dict[str, Any]) -> Union[ToolInvokeMessage, List[ToolInvokeMessage]]:
        """
            invoke tools
        """
        top_n = tool_parameters.get('top_n', 5)
        query = tool_parameters.get('query', '')
        if not query:
            return self.create_text_message('Please input symbol')

        if 'access_tokens' not in self.runtime.credentials or not self.runtime.credentials.get('access_tokens'):
            return self.create_text_message("Github API Access Tokens is required.")
        if 'api_version' not in self.runtime.credentials or not self.runtime.credentials.get('api_version'):
            api_version = '2022-11-28'
        else:
            api_version = self.runtime.credentials.get('api_version')

        try:
            headers = {
                "Content-Type": "application/vnd.github+json",
                "Authorization": f"Bearer {self.runtime.credentials.get('access_tokens')}",
                "X-GitHub-Api-Version": api_version
            }
            s = requests.session()
            api_domain = 'https://api.github.com'
            response = s.request(method='GET', headers=headers,
                                 url=f"{api_domain}/search/repositories?"
                                     f"q={quote(query)}&sort=stars&per_page={top_n}&order=desc")
            response_data = response.json()
            if response.status_code == 200 and isinstance(response_data.get('items'), list):
                contents = list()
                if len(response_data.get('items')) > 0:
                    for item in response_data.get('items'):
                        content = dict()
                        updated_at_object = datetime.strptime(item['updated_at'], "%Y-%m-%dT%H:%M:%SZ")
                        content['owner'] = item['owner']['login']
                        content['name'] = item['name']
                        content['description'] = item['description'][:100] + '...' if len(item['description']) > 100 else item['description']
                        content['url'] = item['html_url']
                        content['star'] = item['watchers']
                        content['forks'] = item['forks']
                        content['updated'] = updated_at_object.strftime("%Y-%m-%d")
                        contents.append(content)
                    s.close()
                    return self.create_text_message(self.summary(user_id=user_id, content=json.dumps(contents, ensure_ascii=False)))
                else:
                    return self.create_text_message(f'No items related to {query} were found.')
            else:
                return self.create_text_message((response.json()).get('message'))
        except Exception as e:
            return self.create_text_message("Github API Key and Api Version is invalid. {}".format(e))
