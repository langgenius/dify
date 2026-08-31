from collections.abc import Generator
from typing import Any

from dify_plugin.entities.tool import ToolInvokeMessage

import common.tool
from common.client import MrscraperClient
from common.payloads import build_rendered_request


class MrscraperFetchRenderedHtmlTool(common.tool.MrscraperTool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage, None, None]:
        query, body, timeout = build_rendered_request(tool_parameters)
        response = self._client().request(
            "POST",
            origin=MrscraperClient.RENDERED_ORIGIN,
            path="/",
            auth="query",
            params=query,
            json_body=body,
            read_timeout=timeout + 30,
        )
        yield from self._messages(response)
