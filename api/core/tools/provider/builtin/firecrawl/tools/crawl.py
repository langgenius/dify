from typing import Any, Union

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.provider.builtin.firecrawl.firecrawl_appx import FirecrawlApp
from core.tools.tool.builtin_tool import BuiltinTool


class CrawlTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        # initialize the app object with the api key
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

        # crawl the url
        crawl_result = app.crawl_url(
            url=tool_parameters['url'], 
            params=options,
            wait_until_done=True, 
        )
        
        # reformat crawl result
        crawl_output = "**Crawl Result**\n\n"
        try:
            for result in crawl_result:
                crawl_output += f"**- Title:** {result.get('metadata', {}).get('title', '')}\n"
                crawl_output += f"**- Description:** {result.get('metadata', {}).get('description', '')}\n"
                crawl_output += f"**- URL:** {result.get('metadata', {}).get('ogUrl', '')}\n\n"
                crawl_output += f"**- Web Content:**\n{result.get('markdown', '')}\n\n"
                crawl_output += "---\n\n"
        except Exception as e:
            crawl_output += f"An error occurred: {str(e)}\n"
            crawl_output += f"**- Title:** {result.get('metadata', {}).get('title', '')}\n"
            crawl_output += f"**- Description:** {result.get('metadata', {}).get('description','')}\n"
            crawl_output += f"**- URL:** {result.get('metadata', {}).get('ogUrl', '')}\n\n"
            crawl_output += f"**- Web Content:**\n{result.get('markdown', '')}\n\n"
            crawl_output += "---\n\n"


        return self.create_text_message(crawl_output)