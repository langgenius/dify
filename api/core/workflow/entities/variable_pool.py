from collections import defaultdict
from collections.abc import Mapping, Sequence
from typing import Any, Union

from pydantic import BaseModel, Field, model_validator
from typing_extensions import deprecated

from core.app.segments import Segment, Variable, factory
from core.file.file_obj import FileVar
from core.workflow.enums import SystemVariableKey

VariableValue = Union[str, int, float, dict, list, FileVar]


SYSTEM_VARIABLE_NODE_ID = "sys"
ENVIRONMENT_VARIABLE_NODE_ID = "env"
CONVERSATION_VARIABLE_NODE_ID = "conversation"


class VariablePool(BaseModel):
    # Variable dictionary is a dictionary for looking up variables by their selector.
    # The first element of the selector is the node id, it's the first-level key in the dictionary.
    # Other elements of the selector are the keys in the second-level dictionary. To get the key, we hash the
    # elements of the selector except the first one.
    variable_dictionary: dict[str, dict[int, Segment]] = Field(
        description="Variables mapping", default=defaultdict(dict)
    )

    # TODO: This user inputs is not used for pool.
    user_inputs: Mapping[str, Any] = Field(
        description="User inputs",
    )

    system_variables: Mapping[SystemVariableKey, Any] = Field(
        description="System variables",
    )

    environment_variables: Sequence[Variable] = Field(description="Environment variables.", default_factory=list)

    conversation_variables: Sequence[Variable] | None = None

    @model_validator(mode="after")
    def val_model_after(self):
        """
        Append system variables
        :return:
        """
        # Add system variables to the variable pool
        for key, value in self.system_variables.items():
            self.add((SYSTEM_VARIABLE_NODE_ID, key.value), value)

        # Add environment variables to the variable pool
        for var in self.environment_variables or []:
            self.add((ENVIRONMENT_VARIABLE_NODE_ID, var.name), var)

        # Add conversation variables to the variable pool
        for var in self.conversation_variables or []:
            self.add((CONVERSATION_VARIABLE_NODE_ID, var.name), var)

        return self

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
            raise ValueError("Invalid selector")

        if value is None:
            return

        if isinstance(value, Segment):
            v = value
        else:
            v = factory.build_segment(value)

        hash_key = hash(tuple(selector[1:]))
        self.variable_dictionary[selector[0]][hash_key] = v

    def get(self, selector: Sequence[str], /) -> Segment | None:
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
            raise ValueError("Invalid selector")
        hash_key = hash(tuple(selector[1:]))
        value = self.variable_dictionary[selector[0]].get(hash_key)

        return value

    @deprecated("This method is deprecated, use `get` instead.")
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
            raise ValueError("Invalid selector")
        hash_key = hash(tuple(selector[1:]))
        value = self.variable_dictionary[selector[0]].get(hash_key)
        return value.to_object() if value else None

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
            self.variable_dictionary[selector[0]] = {}
            return
        hash_key = hash(tuple(selector[1:]))
        self.variable_dictionary[selector[0]].pop(hash_key, None)

    def remove_node(self, node_id: str, /):
        """
        Remove all variables associated with a given node id.

        Args:
            node_id (str): The node id to remove.

        Returns:
            None
        """
        self.variable_dictionary.pop(node_id, None)
