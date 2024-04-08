from typing import Literal, Union

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
        value: Union[ToolParameterValue, list[str]]
        type: Literal['mixed', 'variable', 'constant']

        # TODO[pydantic]: We couldn't refactor the `validator`, please replace it by `field_validator` manually.
        # Check https://docs.pydantic.dev/dev-v2/migration/#changes-to-validators for more information.
        @validator('type', pre=True, always=True)
        def check_type(cls, value, values):
            typ = value
            value = values.get('value')
            if typ == 'mixed' and not isinstance(value, str):
                raise ValueError('value must be a string')
            elif typ == 'variable' and not isinstance(value, list):
                raise ValueError('value must be a list')
            elif typ == 'constant' and not isinstance(value, ToolParameterValue):
                raise ValueError('value must be a string, int, float, or bool')
            return typ
            
    """
    Tool Node Schema
    """
    tool_parameters: dict[str, ToolInput]
