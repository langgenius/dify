import json
from typing import Any, Union

from yarl import URL

from core.helper import ssrf_proxy
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class JinaReaderTool(BuiltinTool):
    _jina_reader_endpoint = "https://r.jina.ai/"

    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        url = tool_parameters["url"]

        headers = {"Accept": "application/json"}

        if "api_key" in self.runtime.credentials and self.runtime.credentials.get("api_key"):
            headers["Authorization"] = "Bearer " + self.runtime.credentials.get("api_key")

        request_params = tool_parameters.get("request_params")
        if request_params is not None and request_params != "":
            try:
                request_params = json.loads(request_params)
                if not isinstance(request_params, dict):
                    raise ValueError("request_params must be a JSON object")
            except (json.JSONDecodeError, ValueError) as e:
                raise ValueError(f"Invalid request_params: {e}")

        target_selector = tool_parameters.get("target_selector")
        if target_selector is not None and target_selector != "":
            headers["X-Target-Selector"] = target_selector

        wait_for_selector = tool_parameters.get("wait_for_selector")
        if wait_for_selector is not None and wait_for_selector != "":
            headers["X-Wait-For-Selector"] = wait_for_selector

        remove_selector = tool_parameters.get("remove_selector")
        if remove_selector is not None and remove_selector != "":
            headers["X-Remove-Selector"] = remove_selector

        if tool_parameters.get("retain_images", False):
            headers["X-Retain-Images"] = "true"

        if tool_parameters.get("image_caption", False):
            headers["X-With-Generated-Alt"] = "true"

        if tool_parameters.get("gather_all_links_at_the_end", False):
            headers["X-With-Links-Summary"] = "true"

        if tool_parameters.get("gather_all_images_at_the_end", False):
            headers["X-With-Images-Summary"] = "true"

        proxy_server = tool_parameters.get("proxy_server")
        if proxy_server is not None and proxy_server != "":
            headers["X-Proxy-Url"] = proxy_server

        if tool_parameters.get("no_cache", False):
            headers["X-No-Cache"] = "true"

        if tool_parameters.get("with_iframe", False):
            headers["X-With-Iframe"] = "true"

        if tool_parameters.get("with_shadow_dom", False):
            headers["X-With-Shadow-Dom"] = "true"

        max_retries = tool_parameters.get("max_retries", 3)
        response = ssrf_proxy.get(
            str(URL(self._jina_reader_endpoint + url)),
            headers=headers,
            params=request_params,
            timeout=(10, 60),
            max_retries=max_retries,
        )

        if tool_parameters.get("summary", False):
            return self.create_text_message(self.summary(user_id, response.text))

        return self.create_text_message(response.text)
