import re
from collections import defaultdict
from collections.abc import Mapping, Sequence
from typing import Any, Union

from pydantic import BaseModel, Field

from core.file import File, FileAttribute, file_manager
from core.variables import Segment, SegmentGroup, Variable
from core.variables.segments import FileSegment
from factories import variable_factory

from ..constants import CONVERSATION_VARIABLE_NODE_ID, ENVIRONMENT_VARIABLE_NODE_ID, SYSTEM_VARIABLE_NODE_ID
from ..enums import SystemVariableKey

VariableValue = Union[str, int, float, dict, list, File]


VARIABLE_PATTERN = re.compile(r"\{\{#([a-zA-Z0-9_]{1,50}(?:\.[a-zA-Z_][a-zA-Z0-9_]{0,29}){1,10})#\}\}")


class VariablePool(BaseModel):
    # Variable dictionary is a dictionary for looking up variables by their selector.
    # The first element of the selector is the node id, it's the first-level key in the dictionary.
    # Other elements of the selector are the keys in the second-level dictionary. To get the key, we hash the
    # elements of the selector except the first one.
    variable_dictionary: dict[str, dict[int, Segment]] = Field(
        description="Variables mapping",
        default=defaultdict(dict),
    )
    # TODO: This user inputs is not used for pool.
    user_inputs: Mapping[str, Any] = Field(
        description="User inputs",
    )
    system_variables: Mapping[SystemVariableKey, Any] = Field(
        description="System variables",
    )
    environment_variables: Sequence[Variable] = Field(
        description="Environment variables.",
        default_factory=list,
    )
    conversation_variables: Sequence[Variable] = Field(
        description="Conversation variables.",
        default_factory=list,
    )

    def __init__(
        self,
        *,
        system_variables: Mapping[SystemVariableKey, Any] | None = None,
        user_inputs: Mapping[str, Any] | None = None,
        environment_variables: Sequence[Variable] | None = None,
        conversation_variables: Sequence[Variable] | None = None,
        **kwargs,
    ):
        environment_variables = environment_variables or []
        conversation_variables = conversation_variables or []
        user_inputs = user_inputs or {}
        system_variables = system_variables or {}

        super().__init__(
            system_variables=system_variables,
            user_inputs=user_inputs,
            environment_variables=environment_variables,
            conversation_variables=conversation_variables,
            **kwargs,
        )

        for key, value in self.system_variables.items():
            self.add((SYSTEM_VARIABLE_NODE_ID, key.value), value)
        # Add environment variables to the variable pool
        for var in self.environment_variables:
            self.add((ENVIRONMENT_VARIABLE_NODE_ID, var.name), var)
        # Add conversation variables to the variable pool
        for var in self.conversation_variables:
            self.add((CONVERSATION_VARIABLE_NODE_ID, var.name), var)

    def add(self, selector: Sequence[str], value: Any, /) -> None:
        """
        Adds a variable to the variable pool.

        NOTE: You should not add a non-Segment value to the variable pool
        even if it is allowed now.

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

        if isinstance(value, Variable):
            variable = value
        if isinstance(value, Segment):
            variable = variable_factory.segment_to_variable(segment=value, selector=selector)
        else:
            segment = variable_factory.build_segment(value)
            variable = variable_factory.segment_to_variable(segment=segment, selector=selector)

        hash_key = hash(tuple(selector[1:]))
        self.variable_dictionary[selector[0]][hash_key] = variable

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
            return None

        hash_key = hash(tuple(selector[1:]))
        value = self.variable_dictionary[selector[0]].get(hash_key)

        if value is None:
            selector, attr = selector[:-1], selector[-1]
            # Python support `attr in FileAttribute` after 3.12
            if attr not in {item.value for item in FileAttribute}:
                return None
            value = self.get(selector)
            if not isinstance(value, FileSegment):
                return None
            attr = FileAttribute(attr)
            attr_value = file_manager.get_attr(file=value.value, attr=attr)
            return variable_factory.build_segment(attr_value)

        return value

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

    def convert_template(self, template: str, /):
        parts = VARIABLE_PATTERN.split(template)
        segments = []
        for part in filter(lambda x: x, parts):
            if "." in part and (variable := self.get(part.split("."))):
                segments.append(variable)
            else:
                segments.append(variable_factory.build_segment(part))
        return SegmentGroup(value=segments)

    def get_file(self, selector: Sequence[str], /) -> FileSegment | None:
        segment = self.get(selector)
        if isinstance(segment, FileSegment):
            return segment
        return None
