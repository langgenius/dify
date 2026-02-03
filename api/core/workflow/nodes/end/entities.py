from pydantic import BaseModel, Field

from core.workflow.enums import NodeType
from core.workflow.nodes.base.entities import BaseNodeData, OutputVariableEntity


class EndNodeData(BaseNodeData):
    """
    END Node Data.
    """

    type: NodeType = NodeType.END
    outputs: list[OutputVariableEntity]


class EndStreamParam(BaseModel):
    """
    EndStreamParam entity
    """

    end_dependencies: dict[str, list[str]] = Field(
        ..., description="end dependencies (end node id -> dependent node ids)"
    )
    end_stream_variable_selector_mapping: dict[str, list[list[str]]] = Field(
        ..., description="end stream variable selector mapping (end node id -> stream variable selectors)"
    )
