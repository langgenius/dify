from typing import Any

from core.tools.__base.tool import Tool
from core.tools.entities.tool_entities import ToolInvokeMeta
from services.file_service import FileService
from core.tools.entities.tool_entities import (
    ToolEntity,
    ToolIdentity,
    ToolDescription,
    ToolProviderType,
)
from core.tools.entities.values import ToolLabelEnum



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

    def invoke(self, tool_parameters: dict[str, Any]) -> tuple[str, ToolInvokeMeta]:
        file_id = tool_parameters.get("file_id")

        file = FileService.get_file_by_id(file_id)
        if not file:
            msg = f"Media file not found: {file_id}"
            return msg, ToolInvokeMeta.error_instance(msg)

        result = {
            "file_id": file.id,
            "filename": file.filename,
            "content_type": file.content_type,
            "size": file.size,
            "duration": getattr(file, "duration", None),
        }

        return result, ToolInvokeMeta.success_instance()



    @classmethod
    def get_entity(cls) -> ToolEntity:
        return ToolEntity(
            identity=ToolIdentity(
                name="inspect_media",
                provider="media",
                provider_type=ToolProviderType.BUILT_IN,
                icon="🖼️",
                tags=[ToolLabelEnum.MEDIA],
            ),
            description=ToolDescription(
                human="Inspect uploaded media files",
                llm=(
                    "Use this tool to inspect uploaded media files. "
                    "It returns metadata such as filename, content type, "
                    "file size, and duration if available."
                ),
            ),
        )
