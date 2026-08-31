from collections.abc import Generator
from typing import Any

from dify_plugin.entities.tool import ToolInvokeMessage

import common.tool
from common.client import MrscraperClient
from common.validation import boolean, choice, integer, nonblank_string, two_letter_code


class MrscraperSearchGoogleSerpTool(common.tool.MrscraperTool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage, None, None]:
        response_format = choice(
            tool_parameters.get("format"), "format", {"json", "html"}, default="json"
        )
        body = {
            "query": nonblank_string(tool_parameters.get("query"), "query"),
            "region": two_letter_code(tool_parameters.get("region"), "region", default="us"),
            "language": two_letter_code(tool_parameters.get("language"), "language", default="en"),
            "page": integer(tool_parameters.get("page"), "page", default=1, minimum=1),
            "format": response_format,
            "renderJs": boolean(tool_parameters.get("render_js"), "render_js", default=False),
        }
        response = self._client().request(
            "POST",
            origin=MrscraperClient.SERP_ORIGIN,
            path="/api/google/serp/v2/sync",
            auth="bearer",
            json_body=body,
            force_text=response_format == "html",
        )
        yield from self._messages(response)
