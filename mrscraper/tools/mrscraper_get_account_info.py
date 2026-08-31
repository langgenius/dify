from collections.abc import Generator
from typing import Any

from dify_plugin.entities.tool import ToolInvokeMessage

import common.tool
from common.client import MrscraperClient


class MrscraperGetAccountInfoTool(common.tool.MrscraperTool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage, None, None]:
        response = self._client().request(
            "GET",
            origin=MrscraperClient.PRIMARY_ORIGIN,
            path="/api/v1/subscription-accounts",
            auth="primary",
        )
        yield from self._messages(response)
