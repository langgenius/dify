"""vend_web_search tool — web search via DuckDuckGo (0.0001 XNO)."""

from collections.abc import Generator

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from provider.vend_api_merchant import build_tool_call


class VendWebSearchTool(Tool):
    def _invoke(self, user_id: str, tool_parameters: dict) -> Generator[ToolInvokeMessage, None, None]:
        base_url = ((self.runtime.credentials or {}).get("vend_base_url") or "https://extract.paypercall.dev").rstrip("/")
        payment = (self.runtime.credentials or {}).get("payment_header") or None
        yield from build_tool_call("web-search", {"q": tool_parameters["q"]}, payment, base_url)
