import logging
from typing import Any, Union

import httpx

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool

logger = logging.getLogger(__name__)


class QueryDataTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        url = tool_parameters["url"]
        query = tool_parameters["query"]
        timeout = tool_parameters["timeout"]

        params = {}
        params["mode"] = tool_parameters.get("mode", "fast")
        params["wait_for"] = tool_parameters.get("wait_for", 0)
        params["is_scroll_to_bottom_enabled"] = tool_parameters.get("is_scroll_to_bottom_enabled", False)
        params["is_screenshot_enabled"] = tool_parameters.get("is_screenshot_enabled", False)

        endpoint = "https://api.agentql.com/v1/query-data"
        headers = {
            "X-API-Key": self.runtime.credentials["api_key"],
            "Content-Type": "application/json",
        }

        payload = {
            "url": url,
            "query": query,
            "params": params,
        }

        try:
            response = httpx.post(endpoint, headers=headers, json=payload, timeout=timeout)
            response.raise_for_status()

            json = response.json()
            return self.create_json_message(json)

        except httpx.HTTPStatusError as e:
            response = e.response
            if response.status_code in [401, 403]:
                msg = "Please, provide a valid API Key. You can create one at https://dev.agentql.com."
            else:
                try:
                    error_json = response.json()
                    logger.error(  # noqa: TRY400
                        f"Failure response: '{response.status_code} {response.reason_phrase}' with body: {error_json}"
                    )
                    msg = error_json["error_info"] if "error_info" in error_json else error_json["detail"]
                except (ValueError, TypeError):
                    msg = f"HTTP {e}."
            raise ValueError(msg) from e
