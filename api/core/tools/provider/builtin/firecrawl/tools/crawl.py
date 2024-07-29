from typing import Any

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.provider.builtin.firecrawl.firecrawl_appx import FirecrawlApp, get_array_params, get_json_params
from core.tools.tool.builtin_tool import BuiltinTool


class CrawlTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage:
        """
        the crawlerOptions and pageOptions comes from doc here:
        https://docs.firecrawl.dev/api-reference/endpoint/crawl
        """
        app = FirecrawlApp(api_key=self.runtime.credentials['firecrawl_api_key'],
                           base_url=self.runtime.credentials['base_url'])
        crawlerOptions = {}
        pageOptions = {}

        wait_for_results = tool_parameters.get('wait_for_results', True)

        crawlerOptions['excludes'] = get_array_params(tool_parameters, 'excludes')
        crawlerOptions['includes'] = get_array_params(tool_parameters, 'includes')
        crawlerOptions['returnOnlyUrls'] = tool_parameters.get('returnOnlyUrls', False)
        crawlerOptions['maxDepth'] = tool_parameters.get('maxDepth')
        crawlerOptions['mode'] = tool_parameters.get('mode')
        crawlerOptions['ignoreSitemap'] = tool_parameters.get('ignoreSitemap', False)
        crawlerOptions['limit'] = tool_parameters.get('limit', 5)
        crawlerOptions['allowBackwardCrawling'] = tool_parameters.get('allowBackwardCrawling', False)
        crawlerOptions['allowExternalContentLinks'] = tool_parameters.get('allowExternalContentLinks', False)

        pageOptions['headers'] = get_json_params(tool_parameters, 'headers')
        pageOptions['includeHtml'] = tool_parameters.get('includeHtml', False)
        pageOptions['includeRawHtml'] = tool_parameters.get('includeRawHtml', False)
        pageOptions['onlyIncludeTags'] = get_array_params(tool_parameters, 'onlyIncludeTags')
        pageOptions['removeTags'] = get_array_params(tool_parameters, 'removeTags')
        pageOptions['onlyMainContent'] = tool_parameters.get('onlyMainContent', False)
        pageOptions['replaceAllPathsWithAbsolutePaths'] = tool_parameters.get('replaceAllPathsWithAbsolutePaths', False)
        pageOptions['screenshot'] = tool_parameters.get('screenshot', False)
        pageOptions['waitFor'] = tool_parameters.get('waitFor', 0)

        crawl_result = app.crawl_url(
            url=tool_parameters['url'],
            wait=wait_for_results,
            crawlerOptions=crawlerOptions,
            pageOptions=pageOptions
        )

        return self.create_json_message(crawl_result)
