from collections.abc import Generator
from typing import Any

from dify_plugin.entities.tool import ToolInvokeMessage

import common.tool
from common.client import MrscraperClient
from common.validation import choice, integer, nonblank_string


class MrscraperGetResultsTool(common.tool.MrscraperTool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage, None, None]:
        query = {
            "filters[scraperId]": nonblank_string(tool_parameters.get("scraper_id"), "scraper_id"),
            "page": integer(tool_parameters.get("page"), "page", default=1),
            "pageSize": integer(tool_parameters.get("page_size"), "page_size", default=10),
            "sort": choice(
                tool_parameters.get("sort_by"), "sort_by", {"createdAt"}, default="createdAt"
            ),
            "sortOrder": choice(
                tool_parameters.get("sort_order"),
                "sort_order",
                {"ASC", "DESC"},
                default="DESC",
            ),
        }
        response = self._client().request(
            "GET",
            origin=MrscraperClient.PRIMARY_ORIGIN,
            path="/api/v1/results",
            auth="primary",
            params=query,
        )
        yield from self._messages(response)
