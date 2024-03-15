from typing import Literal, Optional, Union

from pydantic import BaseModel, validator

from core.workflow.entities.base_node_data_entities import BaseNodeData

ToolParameterValue = Union[str, int, float, bool]

class ToolEntity(BaseModel):
    provider_id: str
    provider_type: Literal['builtin', 'api']
    provider_name: str # redundancy
    tool_name: str
    tool_label: str # redundancy
    tool_configurations: dict[str, ToolParameterValue]

class ToolNodeData(BaseNodeData, ToolEntity):
    class ToolInput(BaseModel):
        variable: str
        variable_type: Literal['selector', 'static']
        value_selector: Optional[list[str]]
        value: Optional[str]

        @validator('value')
        def check_value(cls, value, values, **kwargs):
            if values['variable_type'] == 'static' and value is None:
                raise ValueError('value is required for static variable')
            return value
        
        @validator('value_selector')
        def check_value_selector(cls, value_selector, values, **kwargs):
            if values['variable_type'] == 'selector' and value_selector is None:
                raise ValueError('value_selector is required for selector variable')
            return value_selector
    
    """
    Tool Node Schema
    """
    tool_parameters: list[ToolInput]
