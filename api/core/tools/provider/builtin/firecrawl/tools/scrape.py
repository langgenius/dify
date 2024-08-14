from typing import Any

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.provider.builtin.firecrawl.firecrawl_appx import FirecrawlApp, get_array_params, get_json_params
from core.tools.tool.builtin_tool import BuiltinTool


class ScrapeTool(BuiltinTool):

    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage:
        """
        the pageOptions and extractorOptions comes from doc here:
        https://docs.firecrawl.dev/api-reference/endpoint/scrape
        """
        app = FirecrawlApp(api_key=self.runtime.credentials['firecrawl_api_key'],
                           base_url=self.runtime.credentials['base_url'])

        pageOptions = {}
        extractorOptions = {}

        pageOptions['headers'] = get_json_params(tool_parameters, 'headers')
        pageOptions['includeHtml'] = tool_parameters.get('includeHtml', False)
        pageOptions['includeRawHtml'] = tool_parameters.get('includeRawHtml', False)
        pageOptions['onlyIncludeTags'] = get_array_params(tool_parameters, 'onlyIncludeTags')
        pageOptions['removeTags'] = get_array_params(tool_parameters, 'removeTags')
        pageOptions['onlyMainContent'] = tool_parameters.get('onlyMainContent', False)
        pageOptions['replaceAllPathsWithAbsolutePaths'] = tool_parameters.get('replaceAllPathsWithAbsolutePaths', False)
        pageOptions['screenshot'] = tool_parameters.get('screenshot', False)
        pageOptions['waitFor'] = tool_parameters.get('waitFor', 0)

        extractorOptions['mode'] = tool_parameters.get('mode', '')
        extractorOptions['extractionPrompt'] = tool_parameters.get('extractionPrompt', '')
        extractorOptions['extractionSchema'] = get_json_params(tool_parameters, 'extractionSchema')

        crawl_result = app.scrape_url(url=tool_parameters['url'],
                                      pageOptions=pageOptions,
                                      extractorOptions=extractorOptions)

        return self.create_json_message(crawl_result)
