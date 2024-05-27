from typing import Any, Literal, Optional

from pydantic import BaseModel, validator

from core.prompt.entities.advanced_prompt_entities import MemoryConfig
from core.workflow.entities.base_node_data_entities import BaseNodeData


class ModelConfig(BaseModel):
    """
     Model Config.
    """
    provider: str
    name: str
    mode: str
    completion_params: dict[str, Any] = {}

class ParameterConfig(BaseModel):
    """
    Parameter Config.
    """
    name: str
    type: Literal['string', 'number', 'bool', 'select', 'array[string]', 'array[number]', 'array[object]']
    options: Optional[list[str]]
    description: str
    required: bool

    @validator('name', pre=True, always=True)
    def validate_name(cls, value):
        if not value:
            raise ValueError('Parameter name is required')
        if value in ['__reason', '__is_success']:
            raise ValueError('Invalid parameter name, __reason and __is_success are reserved')
        return value

class ParameterExtractorNodeData(BaseNodeData):
    """
    Parameter Extractor Node Data.
    """
    model: ModelConfig
    query: list[str]
    parameters: list[ParameterConfig]
    instruction: Optional[str]
    memory: Optional[MemoryConfig]
    reasoning_mode: Literal['function_call', 'prompt']

    @validator('reasoning_mode', pre=True, always=True)
    def set_reasoning_mode(cls, v):
        return v or 'function_call'

    def get_parameter_json_schema(self) -> dict:
        """
        Get parameter json schema.

        :return: parameter json schema
        """
        parameters = {
            'type': 'object',
            'properties': {},
            'required': []
        }

        for parameter in self.parameters:
            parameter_schema = {
                'description': parameter.description
            }

            if parameter.type in ['string', 'select']:
                parameter_schema['type'] = 'string'
            elif parameter.type.startswith('array'):
                parameter_schema['type'] = 'array'
                nested_type = parameter.type[6:-1]
                parameter_schema['items'] = {'type': nested_type}
            else:
                parameter_schema['type'] = parameter.type

            if parameter.type == 'select':
                parameter_schema['enum'] = parameter.options

            parameters['properties'][parameter.name] = parameter_schema
            
            if parameter.required:
                parameters['required'].append(parameter.name)

        return parameters