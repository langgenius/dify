from typing import Any, Union

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.provider.builtin.spider.spiderApp import Spider
from core.tools.tool.builtin_tool import BuiltinTool


class ScrapeTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        # initialize the app object with the api key
        app = Spider(api_key=self.runtime.credentials['spider_api_key'])

        url = tool_parameters['url']
        mode = tool_parameters['mode']
        
        options = {
            'limit': tool_parameters.get('limit', 0),
            'depth': tool_parameters.get('depth', 0),
            'blacklist': tool_parameters.get('blacklist', '').split(',') if tool_parameters.get('blacklist') else [],
            'whitelist': tool_parameters.get('whitelist', '').split(',') if tool_parameters.get('whitelist') else [],
            'readability': tool_parameters.get('readability', False),
        }

        result = ""

        try:
            if mode == 'scrape':
                scrape_result = app.scrape_url(
                    url=url, 
                    params=options,
                )

                for i in scrape_result:
                    result += "URL: " + i.get('url', '') + "\n"
                    result += "CONTENT: " + i.get('content', '') + "\n\n"
            elif mode == 'crawl':
                crawl_result = app.crawl_url(
                    url=tool_parameters['url'], 
                    params=options,
                )
                for i in crawl_result:
                    result += "URL: " + i.get('url', '') + "\n"
                    result += "CONTENT: " + i.get('content', '') + "\n\n"
        except Exception as e:
            return self.create_text_message("An error occured", str(e))

        return self.create_text_message(result)
