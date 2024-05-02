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
    type: Literal['string', 'number', 'bool', 'select']
    options: Optional[list[str]]
    description: str
    required: bool

    @validator
    def validate_name(cls, value):
        if not value:
            raise ValueError('Parameter name is required')
        if value == '__error__':
            raise ValueError('Invalid parameter name, __error__ is reserved')
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
                'type': 'string' if parameter.type in ['string', 'select'] else parameter.type
            }

            if parameter.type == 'select':
                parameter_schema['enum'] = parameter.options

            parameters['properties'][parameter.name] = parameter_schema
            
            if parameter.required:
                parameters['required'].append(parameter.name)

        return parameters