from typing import Any

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.provider.builtin.firecrawl.firecrawl_appx import FirecrawlApp
from core.tools.tool.builtin_tool import BuiltinTool


class MapTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage:
        """
        the api doc:
        https://docs.firecrawl.dev/api-reference/endpoint/map
        """
        app = FirecrawlApp(
            api_key=self.runtime.credentials["firecrawl_api_key"], base_url=self.runtime.credentials["base_url"]
        )
        payload = {}
        payload["search"] = tool_parameters.get("search")
        payload["ignoreSitemap"] = tool_parameters.get("ignoreSitemap", True)
        payload["includeSubdomains"] = tool_parameters.get("includeSubdomains", False)
        payload["limit"] = tool_parameters.get("limit", 5000)

        map_result = app.map(url=tool_parameters["url"], **payload)

        return self.create_json_message(map_result)
