from enum import Enum
from typing import Optional, Union, Any

from core.workflow.entities.node_entities import SystemVariable

VariableValue = Union[str, int, float, dict, list]


class ValueType(Enum):
    """
    Value Type Enum
    """
    STRING = "string"
    NUMBER = "number"
    OBJECT = "object"
    ARRAY = "array"
    FILE = "file"


class VariablePool:
    variables_mapping = {}

    def __init__(self, system_variables: dict[SystemVariable, Any]) -> None:
        # system variables
        # for example:
        # {
        #     'query': 'abc',
        #     'files': []
        # }
        for system_variable, value in system_variables.items():
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
            elif target_value_type == ValueType.ARRAY:
                if not isinstance(value, list):
                    raise ValueError('Invalid value type: array')

        return value
