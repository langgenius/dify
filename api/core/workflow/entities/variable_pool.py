from collections import defaultdict
from collections.abc import Mapping, Sequence
from enum import Enum
from typing import Any, Optional, Union

from typing_extensions import deprecated

from core.app.variables import ArrayVariable, ObjectVariable, Variable, variable_factory
from core.file.file_obj import FileVar
from core.workflow.entities.node_entities import SystemVariable

VariableValue = Union[str, int, float, dict, list, FileVar]


class ValueType(Enum):
    """
    Value Type Enum
    """

    STRING = 'string'
    NUMBER = 'number'
    OBJECT = 'object'
    ARRAY_STRING = 'array[string]'
    ARRAY_NUMBER = 'array[number]'
    ARRAY_OBJECT = 'array[object]'
    ARRAY_FILE = 'array[file]'
    FILE = 'file'


SYSTEM_VARIABLE_NODE_ID = 'sys'
ENVIRONMENT_VARIABLE_NODE_ID = 'env'


class VariablePool:
    def __init__(
        self,
        system_variables: Mapping[SystemVariable, Any],
        user_inputs: Mapping[str, Any],
        # TODO: remove Optional
        environment_variables: Optional[Sequence[Variable]] = None,
    ) -> None:
        # system variables
        # for example:
        # {
        #     'query': 'abc',
        #     'files': []
        # }

        # Varaible dictionary is a dictionary for looking up variables by their selector.
        # The first element of the selector is the node id, it's the first-level key in the dictionary.
        # Other elements of the selector are the keys in the second-level dictionary. To get the key, we hash the
        # elements of the selector except the first one.
        self._variable_dictionary: dict[str, dict[int, Variable]] = defaultdict(dict)

        self.user_inputs = user_inputs
        self.system_variables = system_variables
        for system_variable, value in system_variables.items():
            self.add((SYSTEM_VARIABLE_NODE_ID, system_variable.value), value)
        self.environment_variables = environment_variables or []
        for var in self.environment_variables:
            self.add((ENVIRONMENT_VARIABLE_NODE_ID, var.name), var.value)

    def add(self, selector: Sequence[str], value: Any, /) -> None:
        """
        Adds a variable to the variable pool.

        Args:
            selector (Sequence[str]): The selector for the variable.
            value (VariableValue): The value of the variable.

        Raises:
            ValueError: If the selector is invalid.

        Returns:
            None
        """
        if len(selector) < 2:
            raise ValueError('Invalid selector')

        if value is None:
            return

        if not isinstance(value, Variable):
            v = variable_factory.build_anonymous_variable(value)
        else:
            v = value

        hash_key = hash(tuple(selector[1:]))
        self._variable_dictionary[selector[0]][hash_key] = v

    def get(self, selector: Sequence[str], /) -> Variable | None:
        """
        Retrieves the value from the variable pool based on the given selector.

        Args:
            selector (Sequence[str]): The selector used to identify the variable.

        Returns:
            Any: The value associated with the given selector.

        Raises:
            ValueError: If the selector is invalid.
        """
        if len(selector) < 2:
            raise ValueError('Invalid selector')
        hash_key = hash(tuple(selector[1:]))
        value = self._variable_dictionary[selector[0]].get(hash_key)

        return value

    @deprecated('This method is deprecated, use `get` instead.')
    def get_any(self, selector: Sequence[str], /) -> Any | None:
        """
        Retrieves the value from the variable pool based on the given selector.

        Args:
            selector (Sequence[str]): The selector used to identify the variable.

        Returns:
            Any: The value associated with the given selector.

        Raises:
            ValueError: If the selector is invalid.
        """
        if len(selector) < 2:
            raise ValueError('Invalid selector')
        hash_key = hash(tuple(selector[1:]))
        value = self._variable_dictionary[selector[0]].get(hash_key)

        if value is None:
            return value
        if isinstance(value, ArrayVariable):
            return [element.value for element in value.value]
        if isinstance(value, ObjectVariable):
            return {k: v.value for k, v in value.value.items()}
        return value.value if value else None

    def remove(self, selector: Sequence[str], /):
        """
        Remove variables from the variable pool based on the given selector.

        Args:
            selector (Sequence[str]): A sequence of strings representing the selector.

        Returns:
            None
        """
        if not selector:
            return
        if len(selector) == 1:
            self._variable_dictionary[selector[0]] = {}
            return
        hash_key = hash(tuple(selector[1:]))
        self._variable_dictionary[selector[0]].pop(hash_key, None)
