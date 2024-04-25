from typing import Any, Union
import requests

from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage


class GetCrawlStatusTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        url = f"https://api.firecrawl.dev/v0/crawl/status/{tool_parameters['jobId']}"
        headers = {
            "Authorization": f"Bearer {self.runtime.credentials['firecrawl_api_key']}"
        }
        response = requests.get(url, headers=headers)
        return self.create_text_message(response.text)