from collections.abc import Generator
from typing import Any

from dify_plugin.entities.tool import ToolInvokeMessage

import common.tool
from common.client import MrscraperClient
from common.payloads import build_existing_run


class MrscraperExistingRunTool(common.tool.MrscraperTool):
    scraper_type: str
    agent_type: str | None = None

    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage, None, None]:
        parameters = tool_parameters | {"scraper_type": self.scraper_type}
        if self.agent_type:
            parameters["agent_type"] = self.agent_type
        path, body = build_existing_run(parameters)
        response = self._client().request(
            "POST",
            origin=MrscraperClient.PRIMARY_ORIGIN,
            path=path,
            auth="primary",
            json_body=body,
        )
        yield from self._messages(response)
