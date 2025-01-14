from typing import Any

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.utils.jotterpad_api_utils import JotterPadRequest


class ClearExportDocumentFilesTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage:
        jotterpad_api_key = self.runtime.credentials.get("jotterpad_api_key")
        client = JotterPadRequest(jotterpad_api_key)

        success = client.clear_export_document_files()

        return self.create_text_message(success)
