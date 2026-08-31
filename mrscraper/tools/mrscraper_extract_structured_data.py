import json
from collections.abc import Generator
from pathlib import Path
from typing import Any

from dify_plugin.entities.tool import ToolInvokeMessage

import common.tool
from common.client import MrscraperClient
from common.payloads import build_general_payload
from common.validation import choice

PROMPTS_PATH = Path(__file__).resolve().parent.parent / "common" / "structured_data_prompts.json"
STRUCTURED_DATA_PROMPTS: dict[str, str] = json.loads(PROMPTS_PATH.read_text(encoding="utf-8"))


class MrscraperExtractStructuredDataTool(common.tool.MrscraperTool):
    def _invoke(self, tool_parameters: dict[str, Any]) -> Generator[ToolInvokeMessage, None, None]:
        category = choice(
            tool_parameters.get("category"),
            "category",
            set(STRUCTURED_DATA_PROMPTS),
            default="article",
        )
        payload = build_general_payload(
            {
                "url": tool_parameters.get("url"),
                "prompt": STRUCTURED_DATA_PROMPTS[category],
                "mode": tool_parameters.get("mode"),
                "proxy_country": tool_parameters.get("proxy_country"),
            }
        )
        response = self._client().request(
            "POST",
            origin=MrscraperClient.PRIMARY_ORIGIN,
            path="/api/v1/scrapers-ai",
            auth="primary",
            json_body=payload,
        )
        yield from self._messages(response)
