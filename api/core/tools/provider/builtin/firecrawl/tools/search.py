from typing import Any

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.provider.builtin.firecrawl.firecrawl_appx import FirecrawlApp
from core.tools.tool.builtin_tool import BuiltinTool


class SearchTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage:
        """
        the pageOptions and searchOptions comes from doc here:
        https://docs.firecrawl.dev/api-reference/endpoint/search
        """
        app = FirecrawlApp(api_key=self.runtime.credentials['firecrawl_api_key'],
                           base_url=self.runtime.credentials['base_url'])
        pageOptions = {}
        pageOptions['onlyMainContent'] = tool_parameters.get('onlyMainContent', False)
        pageOptions['fetchPageContent'] = tool_parameters.get('fetchPageContent', True)
        pageOptions['includeHtml'] = tool_parameters.get('includeHtml', False)
        pageOptions['includeRawHtml'] = tool_parameters.get('includeRawHtml', False)
        searchOptions = {'limit': tool_parameters.get('limit')}
        search_result = app.search(
            query=tool_parameters['keyword'],
            pageOptions=pageOptions,
            searchOptions=searchOptions
        )

        return self.create_json_message(search_result)
