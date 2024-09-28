from typing import Any, Union

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.provider.builtin.typewriter.tools.markdown_utils import MarkdownUtils
from core.tools.tool.builtin_tool import BuiltinTool


class MarkdownToHtmlFile(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        # get expression
        markdown_text: str = tool_parameters.get("markdown_text")
        if not markdown_text:
            return self.create_text_message("Invalid input markdown_text")

        markdown_text = MarkdownUtils.strip_markdown_wrapper(markdown_text)

        try:
            html_str = MarkdownUtils.convert_markdown_to_html(markdown_text)
            result_file_bytes = html_str.encode("utf-8")
        except Exception as e:
            return self.create_text_message(f"Failed to convert markdown text to html, error: {str(e)}")

        return [
            self.create_text_message("The HTML file is saved."),
            self.create_blob_message(blob=result_file_bytes, meta={"mime_type": "text/html"}),
        ]
