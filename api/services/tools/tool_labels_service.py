from core.tools.entities.tool_entities import ToolLabel
from core.tools.entities.values import default_tool_labels


class ToolLabelsService:
    @classmethod
    def list_tool_labels(cls) -> list[ToolLabel]:
        return default_tool_labels
