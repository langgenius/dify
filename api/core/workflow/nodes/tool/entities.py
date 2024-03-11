from typing import Literal, Optional, Union

from pydantic import BaseModel, validator

from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.variable_entities import VariableSelector

ToolParameterValue = Union[str, int, float, bool]

class ToolEntity(BaseModel):
    provider_id: str
    provider_type: Literal['builtin', 'api']
    provider_name: str # redundancy
    tool_name: str
    tool_label: str # redundancy
    tool_configurations: dict[str, ToolParameterValue]

class ToolNodeData(BaseNodeData, ToolEntity):
    class ToolInput(VariableSelector):
        variable_type: Literal['selector', 'static']
        value: Optional[str]

        @validator('value')
        def check_value(cls, value, values, **kwargs):
            if values['variable_type'] == 'static' and value is None:
                raise ValueError('value is required for static variable')
            return value
    
    """
    Tool Node Schema
    """
    tool_parameters: list[ToolInput]
