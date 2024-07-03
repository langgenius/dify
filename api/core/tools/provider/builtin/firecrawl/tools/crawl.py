import json
from typing import Any, Union

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.provider.builtin.firecrawl.firecrawl_appx import FirecrawlApp
from core.tools.tool.builtin_tool import BuiltinTool

class CrawlTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        app = FirecrawlApp(api_key=self.runtime.credentials['firecrawl_api_key'], base_url=self.runtime.credentials['base_url'])

        options = {
            'crawlerOptions': {
                'excludes': tool_parameters.get('excludes', '').split(',') if tool_parameters.get('excludes') else [],
                'includes': tool_parameters.get('includes', '').split(',') if tool_parameters.get('includes') else [],
                'limit': tool_parameters.get('limit', 5)
            },
            'pageOptions': {
                'onlyMainContent': tool_parameters.get('onlyMainContent', False)
            }
        }

        crawl_result = app.crawl_url(
            url=tool_parameters['url'], 
            wait=True
        )

        if isinstance(crawl_result, dict):
            result_message = json.dumps(crawl_result, ensure_ascii=False, indent=4)
        else:
            result_message = str(crawl_result)

        if not crawl_result:
            return self.create_text_message("Crawl request failed.")

        return self.create_text_message(result_message)
