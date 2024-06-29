from enum import Enum
from typing import Any, Optional, Union

from pydantic import BaseModel, Field

from core.file.file_obj import FileVar
from core.workflow.entities.node_entities import SystemVariable

VariableValue = Union[str, int, float, dict, list, FileVar]


class ValueType(Enum):
    """
    Value Type Enum
    """
    STRING = "string"
    NUMBER = "number"
    OBJECT = "object"
    ARRAY_STRING = "array[string]"
    ARRAY_NUMBER = "array[number]"
    ARRAY_OBJECT = "array[object]"
    ARRAY_FILE = "array[file]"
    FILE = "file"


class VariablePool(BaseModel):

    variables_mapping: dict[str, dict[int, VariableValue]] = Field(
        description='Variables mapping',
        default={},
    )

    user_inputs: dict = Field(
        description='User inputs',
    )

    system_variables: dict[SystemVariable, Any] = Field(
        description='System variables',
    )

    def __post_init__(self):
        for system_variable, value in self.system_variables.items():
            self.append_variable('sys', [system_variable.value], value)

    def append_variable(self, node_id: str, variable_key_list: list[str], value: VariableValue) -> None:
        """
        Append variable
        :param node_id: node id
        :param variable_key_list: variable key list, like: ['result', 'text']
        :param value: value
        :return:
        """
        if node_id not in self.variables_mapping:
            self.variables_mapping[node_id] = {}

        variable_key_list_hash = hash(tuple(variable_key_list))

        self.variables_mapping[node_id][variable_key_list_hash] = value

    def get_variable_value(self, variable_selector: list[str],
                           target_value_type: Optional[ValueType] = None) -> Optional[VariableValue]:
        """
        Get variable
        :param variable_selector: include node_id and variables
        :param target_value_type: target value type
        :return:
        """
        if len(variable_selector) < 2:
            raise ValueError('Invalid value selector')

        node_id = variable_selector[0]
        if node_id not in self.variables_mapping:
            return None

        # fetch variable keys, pop node_id
        variable_key_list = variable_selector[1:]

        variable_key_list_hash = hash(tuple(variable_key_list))

        value = self.variables_mapping[node_id].get(variable_key_list_hash)

        if target_value_type:
            if target_value_type == ValueType.STRING:
                return str(value)
            elif target_value_type == ValueType.NUMBER:
                return int(value)
            elif target_value_type == ValueType.OBJECT:
                if not isinstance(value, dict):
                    raise ValueError('Invalid value type: object')
            elif target_value_type in [ValueType.ARRAY_STRING,
                                       ValueType.ARRAY_NUMBER,
                                       ValueType.ARRAY_OBJECT,
                                       ValueType.ARRAY_FILE]:
                if not isinstance(value, list):
                    raise ValueError(f'Invalid value type: {target_value_type.value}')

        return value

    def clear_node_variables(self, node_id: str) -> None:
        """
        Clear node variables
        :param node_id: node id
        :return:
        """
        if node_id in self.variables_mapping:
            self.variables_mapping.pop(node_id)