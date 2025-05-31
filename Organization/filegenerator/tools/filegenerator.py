from collections.abc import Generator
from typing import Any
import re

from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage


import mimetypes


class FilegeneratorTool(Tool):
    """Generate a downloadable text file based on user input."""

    def _invoke(
        self, tool_parameters: dict[str, Any]
    ) -> Generator[ToolInvokeMessage, None, None]:
        # 1. Retrieve parameters
        content = tool_parameters.get("content")
        title = tool_parameters.get("title")
        ext = tool_parameters.get("ext", ".txt")

        # Normalize extension
        if not ext.startswith("."):
            ext = "." + ext

        # 2. Validate required parameters
        if not content:
            yield self.create_text_message("Error: content is required.")
            return
        if not title:
            yield self.create_text_message("Error: title is required.")
            return

        # Sanitize title to create a safe filename (remove/replace problematic characters)
        sanitized_title = re.sub(r"[^\w\-. ]+", "_", title).strip()
        if not sanitized_title:
            sanitized_title = "file"

        filename = f"{sanitized_title}{ext}"

        # Guess mime type, default to text/plain
        mime_type, _ = mimetypes.guess_type(filename)
        if mime_type is None:
            mime_type = "text/plain"

        try:
            file_bytes = content.encode("utf-8")

            # 3. Return file as blob message (Dify will handle storage & provide download URL)
            yield self.create_blob_message(
                blob=file_bytes,
                meta={
                    "filename": filename,
                    "mime_type": mime_type,
                },
            )

            # 4. Provide workflow variables / JSON
            yield self.create_variable_message("download_filename", filename)
            yield self.create_variable_message("download_url", "{{files[0].url}}")
            yield self.create_json_message({
                "download_url": "{{download_url}}",  # Will be replaced by Dify
                "filename": filename,
            })

        except Exception as e:
            yield self.create_text_message(f"Error generating file: {str(e)}")
