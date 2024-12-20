import time
from typing import Any

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool
from core.tools.utils.jotterpad_api_utils import JotterPadRequest


class InitiatePrintOrExportTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage:
        jotterpad_api_key = self.runtime.credentials.get("jotterpad_api_key")
        client = JotterPadRequest(jotterpad_api_key)

        in_type = tool_parameters.get("in_type")
        out_type = tool_parameters.get("out_type")
        input_content = tool_parameters.get("input_content")
        metadata = tool_parameters.get("metadata")
        name = tool_parameters.get("name")

        export_id = client.initiate_print_or_export(in_type, out_type, input_content, metadata, name)

        download_url = ""

        for x in range(10):
            time.sleep(20)
            exported_file = client.get_export_document_file(export_id)
            if "downloadUrl" in exported_file:
                download_url = exported_file.get("downloadUrl")
                break

        return self.create_text_message(download_url)
