from typing import Any, Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool

SERPER_API_URL = "https://google.serper.dev/search"


class SerperSearchTool(BuiltinTool):

    def _parse_response(self, response: dict) -> dict:
        result = {}
        if "knowledgeGraph" in response:
            result["title"] = response["knowledgeGraph"].get("title", "")
            result["description"] = response["knowledgeGraph"].get("description", "")
        if "organic" in response:
            result["organic"] = [
                {
                    "title": item.get("title", ""),
                    "link": item.get("link", ""),
                    "snippet": item.get("snippet", "")
                }
                for item in response["organic"]
            ]
        return result
    def _invoke(self,
                user_id: str,
                tool_parameters: dict[str, Any],
                ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        params = {
            "q": tool_parameters['query'],
            "gl": "us",
            "hl": "en"
        }
        headers = {
             'X-API-KEY': self.runtime.credentials['serperapi_api_key'],
             'Content-Type': 'application/json'
        }
        response = requests.get(url=SERPER_API_URL, params=params,headers=headers)
        response.raise_for_status()
        valuable_res = self._parse_response(response.json())
        return self.create_json_message(valuable_res)
