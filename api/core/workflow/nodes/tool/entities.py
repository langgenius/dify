from typing import Literal, Union

from pydantic import BaseModel

from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.variable_entities import VariableSelector

ToolParameterValue = Union[str, int, float, bool]

class ToolEntity(BaseModel):
    provider_id: str
    provider_type: Literal['builtin', 'api']
    provider_name: str # redundancy
    tool_name: str
    tool_label: str # redundancy
    tool_parameters: dict[str, ToolParameterValue]


class ToolNodeData(BaseNodeData, ToolEntity):
    """
    Tool Node Schema
    """
    tool_inputs: list[VariableSelector]
