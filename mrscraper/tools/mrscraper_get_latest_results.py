from collections.abc import Generator
from typing import Any

from dify_plugin.entities.tool import ToolInvokeMessage

import common.tool
from common.client import MrscraperClient
from common.validation import integer, nonblank_string


class MrscraperGetLatestResultsTool(common.tool.MrscraperTool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage, None, None]:
        query = {
            "filters[scraperId]": nonblank_string(tool_parameters.get("scraper_id"), "scraper_id"),
            "page": 1,
            "pageSize": integer(tool_parameters.get("count"), "count", default=10),
            "sort": "createdAt",
            "sortOrder": "DESC",
        }
        response = self._client().request(
            "GET",
            origin=MrscraperClient.PRIMARY_ORIGIN,
            path="/api/v1/results",
            auth="primary",
            params=query,
        )
        yield from self._messages(response)
