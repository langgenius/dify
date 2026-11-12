from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from copy import deepcopy
from typing import Annotated, Any, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from graphon.file import file_manager
from graphon.file.enums import FileAttribute
from graphon.file.models import File
from graphon.variables.consts import SELECTORS_LENGTH
from graphon.variables.factory import (
    build_segment,
    segment_to_variable,
)
from graphon.variables.segments import FileSegment, ObjectSegment, Segment
from graphon.variables.variables import RAGPipelineVariableInput, Variable

type VariableValue = str | int | float | dict[str, object] | list[object] | File


def _default_variable_dictionary() -> defaultdict[str, dict[str, Variable]]:
    return defaultdict(dict)


class VariablePool(BaseModel):
    _SYSTEM_VARIABLE_NODE_ID = "sys"
    _ENVIRONMENT_VARIABLE_NODE_ID = "env"
    _CONVERSATION_VARIABLE_NODE_ID = "conversation"
    _RAG_PIPELINE_VARIABLE_NODE_ID = "rag"
    model_config = ConfigDict(extra="forbid")

    # Variable dictionary is a dictionary for looking up variables by their selector.
    # The first element of the selector is the node id.
    # It's the first-level key in the dictionary.
    # Other elements of the selector are keys in the second-level dictionary.
    # To get the key, we hash the elements of the selector except the first one.
    #
    # The `variable_dictionary` is the source of truth for the runtime
    # value of variables.
    variable_dictionary: defaultdict[
        str,
        Annotated[dict[str, Variable], Field(default_factory=dict)],
    ] = Field(
        description="Variables mapping",
        default_factory=_default_variable_dictionary,
    )

    @model_validator(mode="before")
    @classmethod
    def _reject_legacy_constructor_kwargs(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value

        legacy_keys = sorted(
            {
                "system_variables",
                "environment_variables",
                "conversation_variables",
                "rag_pipeline_variables",
                "user_inputs",
            }.intersection(value),
        )
        if not legacy_keys:
            return value

        joined_keys = ", ".join(legacy_keys)
        msg = (
            "VariablePool() no longer accepts legacy bootstrap inputs "
            f"({joined_keys}); use VariablePool.from_bootstrap(...)."
        )
        raise ValueError(msg)

    @classmethod
    def from_bootstrap(
        cls,
        *,
        system_variables: Sequence[Variable] = (),
        environment_variables: Sequence[Variable] = (),
        conversation_variables: Sequence[Variable] = (),
        rag_pipeline_variables: Sequence[RAGPipelineVariableInput] = (),
        user_inputs: Mapping[str, Any] | None = None,
    ) -> Self:
        """Build a pool from workflow bootstrap inputs.

        The default constructor remains focused on the normalized
        `variable_dictionary` payload. `user_inputs` is accepted for
        compatibility with older workflow bootstrap code but is not stored on the
        pool.

        Returns:
            A normalized variable pool populated from the provided bootstrap inputs.
        """
        del user_inputs

        pool = cls()
        pool._ingest_legacy_variables(
            system_variables,
            node_id=pool._SYSTEM_VARIABLE_NODE_ID,
        )
        pool._ingest_legacy_variables(
            environment_variables,
            node_id=pool._ENVIRONMENT_VARIABLE_NODE_ID,
        )
        pool._ingest_legacy_variables(
            conversation_variables,
            node_id=pool._CONVERSATION_VARIABLE_NODE_ID,
        )
        pool._ingest_legacy_rag_variables(rag_pipeline_variables)
        return pool

    def _ingest_legacy_variables(
        self,
        variables: Sequence[Variable],
        *,
        node_id: str,
    ) -> None:
        for variable in variables:
            selector = [node_id, variable.name]
            normalized_variable = variable
            if list(variable.selector) != selector:
                normalized_variable = variable.model_copy(update={"selector": selector})
            self.add(normalized_variable.selector, normalized_variable)

    def _ingest_legacy_rag_variables(
        self,
        rag_pipeline_variables: Sequence[RAGPipelineVariableInput],
    ) -> None:
        if not rag_pipeline_variables:
            return

        values_by_node_id: defaultdict[str, dict[str, Any]] = defaultdict(dict)
        for rag_variable_input in rag_pipeline_variables:
            values_by_node_id[rag_variable_input.variable.belong_to_node_id][
                rag_variable_input.variable.variable
            ] = rag_variable_input.value

        for node_id, value in values_by_node_id.items():
            self.add((self._RAG_PIPELINE_VARIABLE_NODE_ID, node_id), value)

    def add(self, selector: Sequence[str], value: Any, /) -> None:
        """Add a variable to the variable pool.

        This method accepts a selector path and a value, converting the value
        to a Variable object if necessary before storing it in the pool.

        Args:
            selector: A two-element sequence containing [node_id, variable_name].
                     The selector must have exactly 2 elements to be valid.
            value: The value to store. Can be a Variable, Segment, or any value
                  that can be converted to a Segment (str, int, float,
                  dict, list, File).

        Raises:
            ValueError: If selector length is not exactly 2 elements.

        Note:
            While non-Segment values are currently accepted and automatically
            converted, it's recommended to pass Segment or Variable objects directly.

        """
        if len(selector) != SELECTORS_LENGTH:
            msg = (
                f"Invalid selector: expected {SELECTORS_LENGTH} elements "
                f"(node_id, variable_name), got {len(selector)} elements"
            )
            raise ValueError(msg)

        match value:
            case Segment():
                variable = segment_to_variable(segment=value, selector=selector)
            case _:
                segment = build_segment(value)
                variable = segment_to_variable(segment=segment, selector=selector)

        node_id, name = self._selector_to_keys(selector)
        self.variable_dictionary[node_id][name] = variable

    @classmethod
    def _selector_to_keys(cls, selector: Sequence[str]) -> tuple[str, str]:
        return selector[0], selector[1]

    def _has(self, selector: Sequence[str]) -> bool:
        node_id, name = self._selector_to_keys(selector)
        return (
            node_id in self.variable_dictionary
            and name in self.variable_dictionary[node_id]
        )

    def get(self, selector: Sequence[str], /) -> Segment | None:
        """Retrieve a variable's value from the pool as a Segment.

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
            Returns None if selector has fewer than 2 elements or if an invalid
            file attribute is requested.

        """
        if len(selector) < SELECTORS_LENGTH:
            return None

        node_id, name = self._selector_to_keys(selector)
        node_map = self.variable_dictionary.get(node_id)
        segment = node_map.get(name) if node_map is not None else None
        if segment is None or len(selector) == SELECTORS_LENGTH:
            return segment

        match segment:
            case FileSegment():
                result = self._get_file_attribute_segment(
                    segment=segment,
                    attr=selector[2],
                )
            case _:
                result = self._get_nested_segment(
                    segment=segment,
                    selector=selector[2:],
                )
        return result

    def get_variable(self, selector: Sequence[str], /) -> Variable | None:
        """Retrieve a stored top-level variable without attribute traversal."""
        if len(selector) != SELECTORS_LENGTH:
            return None
        node_id, name = self._selector_to_keys(selector)
        node_map = self.variable_dictionary.get(node_id)
        return node_map.get(name) if node_map is not None else None

    def _get_file_attribute_segment(
        self,
        *,
        segment: FileSegment,
        attr: str,
    ) -> Segment | None:
        if attr not in FileAttribute:
            return None
        file_attr = FileAttribute(attr)
        attr_value = file_manager.get_attr(file=segment.value, attr=file_attr)
        return build_segment(attr_value)

    def _get_nested_segment(
        self,
        *,
        segment: Segment,
        selector: Sequence[str],
    ) -> Segment | None:
        result: Any = segment
        for attr in selector:
            result = self._extract_value(result)
            result = self._get_nested_attribute(result, attr)
            if result is None:
                return None
        match result:
            case Segment():
                nested_segment = result
            case _:
                nested_segment = build_segment(result)
        return nested_segment

    def _extract_value(self, obj: Any) -> Any:
        """Extract the actual value from an ObjectSegment."""
        match obj:
            case ObjectSegment():
                result = obj.value
            case _:
                result = obj
        return result

    def _get_nested_attribute(
        self,
        obj: Mapping[str, Any],
        attr: str,
    ) -> Segment | None:
        """Get a nested attribute from a dictionary-like object.

        Args:
            obj: The dictionary-like object to search.
            attr: The key to look up.

        Returns:
            Segment | None:
                The corresponding Segment built from the attribute value if the
                key exists, otherwise None.

        """
        match obj:
            case dict() if attr in obj:
                result = build_segment(obj.get(attr))
            case _:
                result = None
        return result

    def remove(self, selector: Sequence[str], /) -> None:
        """Remove variables from the variable pool based on the given selector.

        Args:
            selector (Sequence[str]): A sequence of strings representing the selector.

        """
        if not selector:
            return
        if len(selector) == 1:
            self.variable_dictionary[selector[0]] = {}
            return
        key, hash_key = self._selector_to_keys(selector)
        self.variable_dictionary[key].pop(hash_key, None)

    def get_file(self, selector: Sequence[str], /) -> FileSegment | None:
        segment = self.get(selector)
        match segment:
            case FileSegment():
                result = segment
            case _:
                result = None
        return result

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

    def flatten(self, *, unprefixed_node_id: str | None = None) -> Mapping[str, object]:
        """Return a selector-style snapshot of the entire variable pool."""
        result: dict[str, object] = {}
        for node_id, variables in self.variable_dictionary.items():
            for name, variable in variables.items():
                output_name = (
                    name if node_id == unprefixed_node_id else f"{node_id}.{name}"
                )
                result[output_name] = deepcopy(variable.value)

        return result

    @classmethod
    def empty(cls) -> VariablePool:
        """Create an empty variable pool."""
        return cls()
