from pydantic import BaseModel, Field

from dify_graph.entities.base_node_data import BaseNodeData
from dify_graph.enums import BuiltinNodeTypes, NodeType
from dify_graph.nodes.base.entities import OutputVariableEntity


class EndNodeData(BaseNodeData):
    """
    END Node Data.
    """

    type: NodeType = BuiltinNodeTypes.END
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
