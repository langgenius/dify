from typing import Any, Literal, Union

from pydantic import BaseModel, validator

from core.workflow.entities.base_node_data_entities import BaseNodeData


class ToolEntity(BaseModel):
    provider_id: str
    provider_type: Literal['builtin', 'api', 'workflow']
    provider_name: str # redundancy
    tool_name: str
    tool_label: str # redundancy
    tool_configurations: dict[str, Any]

    @validator('tool_configurations', pre=True, always=True)
    def validate_tool_configurations(cls, value, values):
        if not isinstance(value, dict):
            raise ValueError('tool_configurations must be a dictionary')
        
        for key in values.get('tool_configurations', {}).keys():
            value = values.get('tool_configurations', {}).get(key)
            if not isinstance(value, str | int | float | bool):
                raise ValueError(f'{key} must be a string')
            
        return value

class ToolNodeData(BaseNodeData, ToolEntity):
    class ToolInput(BaseModel):
        value: Union[Any, list[str]]
        type: Literal['mixed', 'variable', 'constant']

        @validator('type', pre=True, always=True)
        def check_type(cls, value, values):
            typ = value
            value = values.get('value')
            if typ == 'mixed' and not isinstance(value, str):
                raise ValueError('value must be a string')
            elif typ == 'variable':
                if not isinstance(value, list):
                    raise ValueError('value must be a list')
                for val in value:
                    if not isinstance(val, str):
                        raise ValueError('value must be a list of strings')
            elif typ == 'constant' and not isinstance(value, str | int | float | bool):
                raise ValueError('value must be a string, int, float, or bool')
            return typ
        
    """
    Tool Node Schema
    """
    tool_parameters: dict[str, ToolInput]
