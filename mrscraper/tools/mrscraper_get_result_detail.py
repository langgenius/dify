from collections.abc import Generator
from typing import Any
from urllib.parse import quote

from dify_plugin.entities.tool import ToolInvokeMessage

import common.tool
from common.client import MrscraperClient
from common.validation import nonblank_string


class MrscraperGetResultDetailTool(common.tool.MrscraperTool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage, None, None]:
        result_id = quote(nonblank_string(tool_parameters.get("result_id"), "result_id"), safe="")
        response = self._client().request(
            "GET",
            origin=MrscraperClient.PRIMARY_ORIGIN,
            path=f"/api/v1/results/{result_id}",
            auth="primary",
        )
        yield from self._messages(response)
