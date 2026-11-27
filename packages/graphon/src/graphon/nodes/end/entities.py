from pydantic import BaseModel, Field

from graphon.entities.base_node_data import BaseNodeData
from graphon.enums import BuiltinNodeTypes, NodeType
from graphon.nodes.base.entities import OutputVariableEntity


class EndNodeData(BaseNodeData):
    """END Node Data."""

    type: NodeType = BuiltinNodeTypes.END
    outputs: list[OutputVariableEntity]


class EndStreamParam(BaseModel):
    """EndStreamParam entity"""

    end_dependencies: dict[str, list[str]] = Field(
        ...,
        description="end dependencies (end node id -> dependent node ids)",
    )
    end_stream_variable_selector_mapping: dict[str, list[list[str]]] = Field(
        ...,
        description=(
            "end stream variable selector mapping "
            "(end node id -> stream variable selectors)"
        ),
    )
