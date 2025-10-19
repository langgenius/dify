import re
from collections import defaultdict
from collections.abc import Mapping, Sequence
from copy import deepcopy
from typing import Annotated, Any, Union, cast

from pydantic import BaseModel, Field

from core.file import File, FileAttribute, file_manager
from core.variables import Segment, SegmentGroup, Variable
from core.variables.consts import SELECTORS_LENGTH
from core.variables.segments import FileSegment, ObjectSegment
from core.variables.variables import RAGPipelineVariableInput, VariableUnion
from core.workflow.constants import (
    CONVERSATION_VARIABLE_NODE_ID,
    ENVIRONMENT_VARIABLE_NODE_ID,
    RAG_PIPELINE_VARIABLE_NODE_ID,
    SYSTEM_VARIABLE_NODE_ID,
)
from core.workflow.system_variable import SystemVariable
from factories import variable_factory

VariableValue = Union[str, int, float, dict[str, object], list[object], File]

VARIABLE_PATTERN = re.compile(r"\{\{#([a-zA-Z0-9_]{1,50}(?:\.[a-zA-Z_][a-zA-Z0-9_]{0,29}){1,10})#\}\}")


class VariablePool(BaseModel):
    # Variable dictionary is a dictionary for looking up variables by their selector.
    # The first element of the selector is the node id, it's the first-level key in the dictionary.
    # Other elements of the selector are the keys in the second-level dictionary. To get the key, we hash the
    # elements of the selector except the first one.
    variable_dictionary: defaultdict[str, Annotated[dict[str, VariableUnion], Field(default_factory=dict)]] = Field(
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
        default_factory=SystemVariable.empty,
    )
    environment_variables: Sequence[VariableUnion] = Field(
        description="Environment variables.",
        default_factory=list[VariableUnion],
    )
    conversation_variables: Sequence[VariableUnion] = Field(
        description="Conversation variables.",
        default_factory=list[VariableUnion],
    )
    rag_pipeline_variables: list[RAGPipelineVariableInput] = Field(
        description="RAG pipeline variables.",
        default_factory=list,
    )

    def model_post_init(self, context: Any, /):
        # Create a mapping from field names to SystemVariableKey enum values
        self._add_system_variables(self.system_variables)
        # Add environment variables to the variable pool
        for var in self.environment_variables:
            self.add((ENVIRONMENT_VARIABLE_NODE_ID, var.name), var)
        # Add conversation variables to the variable pool
        for var in self.conversation_variables:
            self.add((CONVERSATION_VARIABLE_NODE_ID, var.name), var)
        # Add rag pipeline variables to the variable pool
        if self.rag_pipeline_variables:
            rag_pipeline_variables_map: defaultdict[Any, dict[Any, Any]] = defaultdict(dict)
            for rag_var in self.rag_pipeline_variables:
                node_id = rag_var.variable.belong_to_node_id
                key = rag_var.variable.variable
                value = rag_var.value
                rag_pipeline_variables_map[node_id][key] = value
            for key, value in rag_pipeline_variables_map.items():
                self.add((RAG_PIPELINE_VARIABLE_NODE_ID, key), value)

    def add(self, selector: Sequence[str], value: Any, /):
        """
        Add a variable to the variable pool.

        This method accepts a selector path and a value, converting the value
        to a Variable object if necessary before storing it in the pool.

        Args:
            selector: A two-element sequence containing [node_id, variable_name].
                     The selector must have exactly 2 elements to be valid.
            value: The value to store. Can be a Variable, Segment, or any value
                  that can be converted to a Segment (str, int, float, dict, list, File).

        Raises:
            ValueError: If selector length is not exactly 2 elements.

        Note:
            While non-Segment values are currently accepted and automatically
            converted, it's recommended to pass Segment or Variable objects directly.
        """
        if len(selector) != SELECTORS_LENGTH:
            raise ValueError(
                f"Invalid selector: expected {SELECTORS_LENGTH} elements (node_id, variable_name), "
                f"got {len(selector)} elements"
            )

        if isinstance(value, Variable):
            variable = value
        elif isinstance(value, Segment):
            variable = variable_factory.segment_to_variable(segment=value, selector=selector)
        else:
            segment = variable_factory.build_segment(value)
            variable = variable_factory.segment_to_variable(segment=segment, selector=selector)

        node_id, name = self._selector_to_keys(selector)
        # Based on the definition of `VariableUnion`,
        # `list[Variable]` can be safely used as `list[VariableUnion]` since they are compatible.
        self.variable_dictionary[node_id][name] = cast(VariableUnion, variable)

    @classmethod
    def _selector_to_keys(cls, selector: Sequence[str]) -> tuple[str, str]:
        return selector[0], selector[1]

    def _has(self, selector: Sequence[str]) -> bool:
        node_id, name = self._selector_to_keys(selector)
        if node_id not in self.variable_dictionary:
            return False
        if name not in self.variable_dictionary[node_id]:
            return False
        return True

    def get(self, selector: Sequence[str], /) -> Segment | None:
        """
        Retrieve a variable's value from the pool as a Segment.

        This method supports both simple selectors [node_id, variable_name] and
        extended selectors that include attribute access for FileSegment and
        ObjectSegment types.

        Args:
            selector: A sequence with at least 2 elements:
                     - [node_id, variable_name]: Returns the full segment
                     - [node_id, variable_name, attr, ...]: Returns a nested value
                       from FileSegment (e.g., 'url', 'name') or ObjectSegment

        Returns:
            The Segment associated with the selector, or None if not found.
            Returns None if selector has fewer than 2 elements.

        Raises:
            ValueError: If attempting to access an invalid FileAttribute.
        """
        if len(selector) < SELECTORS_LENGTH:
            return None

        node_id, name = self._selector_to_keys(selector)
        segment: Segment | None = self.variable_dictionary[node_id].get(name)

        if segment is None:
            return None

        if len(selector) == 2:
            return segment

        if isinstance(segment, FileSegment):
            attr = selector[2]
            # Python support `attr in FileAttribute` after 3.12
            if attr not in {item.value for item in FileAttribute}:
                return None
            attr = FileAttribute(attr)
            attr_value = file_manager.get_attr(file=segment.value, attr=attr)
            return variable_factory.build_segment(attr_value)

        # Navigate through nested attributes
        result: Any = segment
        for attr in selector[2:]:
            result = self._extract_value(result)
            result = self._get_nested_attribute(result, attr)
            if result is None:
                return None

        # Return result as Segment
        return result if isinstance(result, Segment) else variable_factory.build_segment(result)

    def _extract_value(self, obj: Any):
        """Extract the actual value from an ObjectSegment."""
        return obj.value if isinstance(obj, ObjectSegment) else obj

    def _get_nested_attribute(self, obj: Mapping[str, Any], attr: str) -> Segment | None:
        """
        Get a nested attribute from a dictionary-like object.

        Args:
            obj: The dictionary-like object to search.
            attr: The key to look up.

        Returns:
            Segment | None:
                The corresponding Segment built from the attribute value if the key exists,
                otherwise None.
        """
        if not isinstance(obj, dict) or attr not in obj:
            return None
        return variable_factory.build_segment(obj.get(attr))

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
        segments: list[Segment] = []
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

    def get_by_prefix(self, prefix: str, /) -> Mapping[str, object]:
        """Return a copy of all variables stored under the given node prefix."""

        nodes = self.variable_dictionary.get(prefix)
        if not nodes:
            return {}

        result: dict[str, object] = {}
        for key, variable in nodes.items():
            value = variable.value
            result[key] = deepcopy(value)

        return result

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
            self.add(selector, value)

    @classmethod
    def empty(cls) -> "VariablePool":
        """Create an empty variable pool."""
        return cls(system_variables=SystemVariable.empty())
