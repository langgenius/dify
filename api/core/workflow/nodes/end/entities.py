from pydantic import BaseModel, Field

from core.workflow.entities.variable_entities import VariableSelector
from core.workflow.nodes.base import BaseNodeData


class EndNodeData(BaseNodeData):
    """
    END Node Data.
    """

    outputs: list[VariableSelector]


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
