from typing import Any

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.utils.feishu_api_utils import FeishuRequest


class GetDocumentRawContentTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage:
        app_id = self.runtime.credentials.get("app_id")
        app_secret = self.runtime.credentials.get("app_secret")
        client = FeishuRequest(app_id, app_secret)

        document_id = tool_parameters.get("document_id")
        mode = tool_parameters.get("mode", "markdown")
        lang = tool_parameters.get("lang", "0")

        res = client.get_document_content(document_id, mode, lang)
        return self.create_json_message(res)
