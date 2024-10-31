from base64 import b64decode
from typing import Any, Union

from openai import OpenAI
from yarl import URL
from core.file.enums import FileType

from core.file.file_manager import download
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolParameterValidationError
from core.tools.tool.builtin_tool import BuiltinTool


class FileExtractorTool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        # image file for workflow mode
        file = tool_parameters.get("file")
        if file and file.type != FileType.DOCUMENT:
            raise ToolParameterValidationError("Not a valid document")

        if file:
            file_binary = download(file)
        else:
            raise ToolParameterValidationError("Please provide either file")
        return result
