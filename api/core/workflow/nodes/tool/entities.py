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
        value_type: Literal['variable', 'static']
        static_value: Optional[Union[int, float, str]]
        variable_value: Optional[Union[str, list[str]]]
        parameter_name: str

        @validator('value_type', pre=True, always=True)
        def check_value_type(cls, value, values):
            if value == 'variable':
                # check if template_value is None
                if values.get('variable_value') is not None:
                    raise ValueError('template_value must be None for value_type variable')
            elif value == 'static':
                # check if static_value is None
                if values.get('static_value') is None:
                    raise ValueError('static_value must be provided for value_type static')
            return value

    """
    Tool Node Schema
    """
    tool_parameters: list[ToolInput]
