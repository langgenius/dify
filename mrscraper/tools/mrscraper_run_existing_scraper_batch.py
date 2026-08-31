from collections.abc import Generator
from typing import Any

from dify_plugin.entities.tool import ToolInvokeMessage

import common.tool
from common.client import MrscraperClient
from common.validation import choice, nonblank_string, url_array


class MrscraperRunExistingScraperBatchTool(common.tool.MrscraperTool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage, None, None]:
        scraper_type = choice(tool_parameters.get("scraper_type"), "scraper_type", {"ai", "manual"})
        prefix = "scrapers-manual-rerun" if scraper_type == "manual" else "scrapers-ai-rerun"
        body = {
            "scraperId": nonblank_string(tool_parameters.get("scraper_id"), "scraper_id"),
            "urls": url_array(tool_parameters.get("urls")),
        }
        response = self._client().request(
            "POST",
            origin=MrscraperClient.PRIMARY_ORIGIN,
            path=f"/api/v1/{prefix}/bulk",
            auth="primary",
            json_body=body,
        )
        yield from self._messages(response)
