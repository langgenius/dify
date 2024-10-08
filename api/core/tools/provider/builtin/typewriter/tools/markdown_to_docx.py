from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any, Union

from markdowntodocx import markdownconverter

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.provider.builtin.typewriter.tools.markdown_utils import MarkdownUtils
from core.tools.tool.builtin_tool import BuiltinTool


class MarkdownToDocxFile(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """

        # get expression
        markdown_text = tool_parameters.get("markdown_text")
        if not markdown_text:
            return self.create_text_message("Invalid input markdown_text")

        try:
            markdown_text = MarkdownUtils.strip_markdown_wrapper(markdown_text)
            with NamedTemporaryFile(suffix=".docx", delete=True) as temp_docx_file:
                markdownconverter.markdownToWordFromString(string=markdown_text, outfile=temp_docx_file)
                result_file_bytes = Path(temp_docx_file.name).read_bytes()
        except Exception as e:
            return self.create_text_message(f"Failed to convert markdown text to DOCX file, error: {str(e)}")

        return [
            self.create_text_message("The DOCX file is saved."),
            self.create_blob_message(
                blob=result_file_bytes,
                meta={"mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
            ),
        ]
