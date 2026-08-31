from collections.abc import Generator
from typing import Any

from dify_plugin.entities.tool import ToolInvokeMessage

import common.tool
from common.client import MrscraperClient
from common.payloads import build_map_payload


class MrscraperCreateWebsiteCrawlScraperTool(common.tool.MrscraperTool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage, None, None]:
        response = self._client().request(
            "POST",
            origin=MrscraperClient.PRIMARY_ORIGIN,
            path="/api/v1/scrapers-ai",
            auth="primary",
            json_body=build_map_payload(tool_parameters),
        )
        yield from self._messages(response)
