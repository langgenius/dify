from core.tools.entities.default import default_tool_labels
from core.tools.entities.tool_entities import ToolLabel


class ToolLabelsService:
    @classmethod
    def list_tool_labels(cls) -> list[ToolLabel]:
        return default_tool_labels