from typing import Any

from scrapegraph_py import Client
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class ScrapeGraphTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage:
        sgai_client = Client(api_key=self.runtime.credentials["scrapegraph_api_key"])

        response = sgai_client.smartscraper(
            website_url=tool_parameters["url"],
            user_prompt=tool_parameters["prompt"],
        )

        return response
