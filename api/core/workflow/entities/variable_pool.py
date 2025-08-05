import re
from collections import defaultdict
from collections.abc import Mapping, Sequence
from typing import Annotated, Any, Union, cast

from pydantic import BaseModel, Field

from core.file import File, FileAttribute, file_manager
from core.variables import Segment, SegmentGroup, Variable
from core.variables.consts import MIN_SELECTORS_LENGTH
from core.variables.segments import FileSegment, NoneSegment
from core.variables.variables import VariableUnion
from core.workflow.constants import CONVERSATION_VARIABLE_NODE_ID, ENVIRONMENT_VARIABLE_NODE_ID, SYSTEM_VARIABLE_NODE_ID
from core.workflow.system_variable import SystemVariable
from factories import variable_factory

VariableValue = Union[str, int, float, dict, list, File]

VARIABLE_PATTERN = re.compile(r"\{\{#([a-zA-Z0-9_]{1,50}(?:\.[a-zA-Z_][a-zA-Z0-9_]{0,29}){1,10})#\}\}")


class VariablePool(BaseModel):
    # Variable dictionary is a dictionary for looking up variables by their selector.
    # The first element of the selector is the node id, it's the first-level key in the dictionary.
    # Other elements of the selector are the keys in the second-level dictionary. To get the key, we hash the
    # elements of the selector except the first one.
    variable_dictionary: defaultdict[str, Annotated[dict[int, VariableUnion], Field(default_factory=dict)]] = Field(
        description="Variables mapping",
        default=defaultdict(dict),
    )

    # The `user_inputs` is used only when constructing the inputs for the `StartNode`. It's not used elsewhere.
    user_inputs: Mapping[str, Any] = Field(
        description="User inputs",
        default_factory=dict,
    )
    system_variables: SystemVariable = Field(
        description="System variables",
    )
    environment_variables: Sequence[VariableUnion] = Field(
        description="Environment variables.",
        default_factory=list,
    )
    conversation_variables: Sequence[VariableUnion] = Field(
        description="Conversation variables.",
        default_factory=list,
    )

    def model_post_init(self, context: Any, /) -> None:
        # Create a mapping from field names to SystemVariableKey enum values
        self._add_system_variables(self.system_variables)
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
        if len(selector) < MIN_SELECTORS_LENGTH:
            raise ValueError("Invalid selector")

        if isinstance(value, Variable):
            variable = value
        elif isinstance(value, Segment):
            variable = variable_factory.segment_to_variable(segment=value, selector=selector)
        else:
            segment = variable_factory.build_segment(value)
            variable = variable_factory.segment_to_variable(segment=segment, selector=selector)

        key, hash_key = self._selector_to_keys(selector)
        # Based on the definition of `VariableUnion`,
        # `list[Variable]` can be safely used as `list[VariableUnion]` since they are compatible.
        self.variable_dictionary[key][hash_key] = cast(VariableUnion, variable)

    @classmethod
    def _selector_to_keys(cls, selector: Sequence[str]) -> tuple[str, int]:
        return selector[0], hash(tuple(selector[1:]))

    def _has(self, selector: Sequence[str]) -> bool:
        key, hash_key = self._selector_to_keys(selector)
        if key not in self.variable_dictionary:
            return False
        if hash_key not in self.variable_dictionary[key]:
            return False
        return True

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
        if len(selector) < MIN_SELECTORS_LENGTH:
            return None

        key, hash_key = self._selector_to_keys(selector)
        value: Segment | None = self.variable_dictionary[key].get(hash_key)

        if value is None:
            selector, attr = selector[:-1], selector[-1]
            # Python support `attr in FileAttribute` after 3.12
            if attr not in {item.value for item in FileAttribute}:
                return None
            value = self.get(selector)
            if not isinstance(value, FileSegment | NoneSegment):
                return None
            if isinstance(value, FileSegment):
                attr = FileAttribute(attr)
                attr_value = file_manager.get_attr(file=value.value, attr=attr)
                return variable_factory.build_segment(attr_value)
            return value

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
        key, hash_key = self._selector_to_keys(selector)
        self.variable_dictionary[key].pop(hash_key, None)

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

    def _add_system_variables(self, system_variable: SystemVariable):
        sys_var_mapping = system_variable.to_dict()
        for key, value in sys_var_mapping.items():
            if value is None:
                continue
            selector = (SYSTEM_VARIABLE_NODE_ID, key)
            # If the system variable already exists, do not add it again.
            # This ensures that we can keep the id of the system variables intact.
            if self._has(selector):
                continue
            self.add(selector, value)  # type: ignore

    @classmethod
    def empty(cls) -> "VariablePool":
        """Create an empty variable pool."""
        return cls(system_variables=SystemVariable.empty())
