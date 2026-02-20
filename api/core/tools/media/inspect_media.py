from collections.abc import Generator
from typing import Any

from core.file import file_manager
from core.i18n import I18nObject
from core.tools.__base.tool import Tool
from core.tools.entities.tool_entities import (
    ToolDescription,
    ToolEntity,
    ToolIdentity,
    ToolInvokeMessage,
)


class InspectMediaTool(Tool):
    name = "inspect_media"
    description = "Inspect uploaded media files and return structured metadata"

    parameters = {
        "type": "object",
        "properties": {
            "file_id": {
                "type": "string",
                "description": "ID of the uploaded media file",
            }
        },
        "required": ["file_id"],
    }

    def invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        file_id = tool_parameters.get("file_id")

        file = file_manager.get_file(file_id)
        if not file:
            yield ToolInvokeMessage.error(f"Media file not found: {file_id}")
            return

        result = {
            "file_id": file.id,
            "filename": file.filename,
            "content_type": file.content_type,
            "size": file.size,
            "duration": getattr(file, "duration", None),
        }

        yield ToolInvokeMessage.success(result)

    @classmethod
    def get_entity(cls) -> ToolEntity:
        return ToolEntity(
            identity=ToolIdentity(
                name="inspect_media",
                provider="media",
                author="dify",
                label=I18nObject.from_dict(
                    {
                        "en-US": "Inspect Media",
                    }
                ),
            ),
            description=ToolDescription(
                human=I18nObject.from_dict(
                    {
                        "en-US": "Inspect uploaded media files",
                    }
                ),
                llm=(
                    "Use this tool to inspect uploaded media files. "
                    "It returns metadata such as filename, content type, "
                    "file size, and duration if available."
                ),
            ),
        )
