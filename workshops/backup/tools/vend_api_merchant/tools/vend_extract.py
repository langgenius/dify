"""vend_extract tool — clean text/markdown from any web page (0.0001 XNO)."""

from collections.abc import Generator

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

from provider.vend_api_merchant import build_tool_call


class VendExtractTool(Tool):
    def _invoke(self, user_id: str, tool_parameters: dict) -> Generator[ToolInvokeMessage, None, None]:
        base_url = ((self.runtime.credentials or {}).get("vend_base_url") or "https://extract.paypercall.dev").rstrip("/")
        payment = (self.runtime.credentials or {}).get("payment_header") or None
        yield from build_tool_call("extract", {"url": tool_parameters["url"]}, payment, base_url)
