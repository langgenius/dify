from __future__ import annotations

import dataclasses
from abc import ABC, abstractmethod
from collections.abc import Mapping
from typing import Any, Generic, TypeAlias, TypeVar, overload

from configs import dify_config
from core.file.models import File
from core.variables.segments import (
    ArrayFileSegment,
    ArraySegment,
    BooleanSegment,
    FileSegment,
    FloatSegment,
    IntegerSegment,
    NoneSegment,
    ObjectSegment,
    Segment,
    StringSegment,
)
from core.variables.utils import dumps_with_segments
from core.workflow.nodes.variable_assigner.common.helpers import UpdatedVariable

_MAX_DEPTH = 100


class _QAKeys:
    """dict keys for _QAStructure"""

    QA_CHUNKS = "qa_chunks"
    QUESTION = "question"
    ANSWER = "answer"


class _PCKeys:
    """dict keys for _ParentChildStructure"""

    PARENT_MODE = "parent_mode"
    PARENT_CHILD_CHUNKS = "parent_child_chunks"
    PARENT_CONTENT = "parent_content"
    CHILD_CONTENTS = "child_contents"


_T = TypeVar("_T")


@dataclasses.dataclass(frozen=True)
class _PartResult(Generic[_T]):
    value: _T
    value_size: int
    truncated: bool


class MaxDepthExceededError(Exception):
    pass


class UnknownTypeError(Exception):
    pass


JSONTypes: TypeAlias = int | float | str | list[object] | dict[str, object] | None | bool


@dataclasses.dataclass(frozen=True)
class TruncationResult:
    result: Segment
    truncated: bool


class BaseTruncator(ABC):
    @abstractmethod
    def truncate(self, segment: Segment) -> TruncationResult:
        pass

    @abstractmethod
    def truncate_variable_mapping(self, v: Mapping[str, Any]) -> tuple[Mapping[str, Any], bool]:
        pass


class VariableTruncator(BaseTruncator):
    """
    Handles variable truncation with structure-preserving strategies.

    This class implements intelligent truncation that prioritizes maintaining data structure
    integrity while ensuring the final size doesn't exceed specified limits.

    Uses recursive size calculation to avoid repeated JSON serialization.
    """

    def __init__(
        self,
        string_length_limit=5000,
        array_element_limit: int = 20,
        max_size_bytes: int = 1024_000,  # 1000 KiB
    ):
        if string_length_limit <= 3:
            raise ValueError("string_length_limit should be greater than 3.")
        self._string_length_limit = string_length_limit

        if array_element_limit <= 0:
            raise ValueError("array_element_limit should be greater than 0.")
        self._array_element_limit = array_element_limit

        if max_size_bytes <= 0:
            raise ValueError("max_size_bytes should be greater than 0.")
        self._max_size_bytes = max_size_bytes

    @classmethod
    def default(cls) -> VariableTruncator:
        return VariableTruncator(
            max_size_bytes=dify_config.WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE,
            array_element_limit=dify_config.WORKFLOW_VARIABLE_TRUNCATION_ARRAY_LENGTH,
            string_length_limit=dify_config.WORKFLOW_VARIABLE_TRUNCATION_STRING_LENGTH,
        )

    def truncate_variable_mapping(self, v: Mapping[str, Any]) -> tuple[Mapping[str, Any], bool]:
        """
        `truncate_variable_mapping` is responsible for truncating variable mappings
        generated during workflow execution, such as `inputs`, `process_data`, or `outputs`
        of a WorkflowNodeExecution record. This ensures the mappings remain within the
        specified size limits while preserving their structure.
        """
        budget = self._max_size_bytes
        is_truncated = False
        truncated_mapping: dict[str, Any] = {}
        length = len(v.items())
        used_size = 0
        for key, value in v.items():
            used_size += self.calculate_json_size(key)
            if used_size > budget:
                truncated_mapping[key] = "..."
                continue
            value_budget = (budget - used_size) // (length - len(truncated_mapping))
            if isinstance(value, Segment):
                part_result = self._truncate_segment(value, value_budget)
            else:
                part_result = self._truncate_json_primitives(value, value_budget)
            is_truncated = is_truncated or part_result.truncated
            truncated_mapping[key] = part_result.value
            used_size += part_result.value_size
        return truncated_mapping, is_truncated

    @staticmethod
    def _segment_need_truncation(segment: Segment) -> bool:
        if isinstance(
            segment,
            (NoneSegment, FloatSegment, IntegerSegment, FileSegment, BooleanSegment, ArrayFileSegment),
        ):
            return False
        return True

    @staticmethod
    def _json_value_needs_truncation(value: Any) -> bool:
        if value is None:
            return False
        if isinstance(value, (bool, int, float)):
            return False
        return True

    def truncate(self, segment: Segment) -> TruncationResult:
        if isinstance(segment, StringSegment):
            result = self._truncate_segment(segment, self._string_length_limit)
        else:
            result = self._truncate_segment(segment, self._max_size_bytes)

        if result.value_size > self._max_size_bytes:
            if isinstance(result.value, str):
                result = self._truncate_string(result.value, self._max_size_bytes)
                return TruncationResult(StringSegment(value=result.value), True)

            # Apply final fallback - convert to JSON string and truncate
            json_str = dumps_with_segments(result.value, ensure_ascii=False)
            if len(json_str) > self._max_size_bytes:
                json_str = json_str[: self._max_size_bytes] + "..."
            return TruncationResult(result=StringSegment(value=json_str), truncated=True)

        return TruncationResult(
            result=segment.model_copy(update={"value": result.value.value}), truncated=result.truncated
        )

    def _truncate_segment(self, segment: Segment, target_size: int) -> _PartResult[Segment]:
        """
        Apply smart truncation to a variable value.

        Args:
            value: The value to truncate (can be Segment or raw value)

        Returns:
            TruncationResult with truncated data and truncation status
        """

        if not VariableTruncator._segment_need_truncation(segment):
            return _PartResult(segment, self.calculate_json_size(segment.value), False)

        result: _PartResult[Any]
        # Apply type-specific truncation with target size
        if isinstance(segment, ArraySegment):
            result = self._truncate_array(segment.value, target_size)
        elif isinstance(segment, StringSegment):
            result = self._truncate_string(segment.value, target_size)
        elif isinstance(segment, ObjectSegment):
            result = self._truncate_object(segment.value, target_size)
        else:
            raise AssertionError("this should be unreachable.")

        return _PartResult(
            value=segment.model_copy(update={"value": result.value}),
            value_size=result.value_size,
            truncated=result.truncated,
        )

    @staticmethod
    def calculate_json_size(value: Any, depth=0) -> int:
        """Recursively calculate JSON size without serialization."""
        if isinstance(value, Segment):
            return VariableTruncator.calculate_json_size(value.value)
        if isinstance(value, UpdatedVariable):
            # TODO(Workflow): migrate UpdatedVariable serialization upstream and drop this fallback.
            return VariableTruncator.calculate_json_size(value.model_dump(), depth=depth + 1)
        if depth > _MAX_DEPTH:
            raise MaxDepthExceededError()
        if isinstance(value, str):
            # Ideally, the size of strings should be calculated based on their utf-8 encoded length.
            # However, this adds complexity as we would need to compute encoded sizes consistently
            # throughout the code. Therefore, we approximate the size using the string's length.
            # Rough estimate: number of characters, plus 2 for quotes
            return len(value) + 2
        elif isinstance(value, (int, float)):
            return len(str(value))
        elif isinstance(value, bool):
            return 4 if value else 5  # "true" or "false"
        elif value is None:
            return 4  # "null"
        elif isinstance(value, list):
            # Size = sum of elements + separators + brackets
            total = 2  # "[]"
            for i, item in enumerate(value):
                if i > 0:
                    total += 1  # ","
                total += VariableTruncator.calculate_json_size(item, depth=depth + 1)
            return total
        elif isinstance(value, dict):
            # Size = sum of keys + values + separators + brackets
            total = 2  # "{}"
            for index, key in enumerate(value.keys()):
                if index > 0:
                    total += 1  # ","
                total += VariableTruncator.calculate_json_size(str(key), depth=depth + 1)  # Key as string
                total += 1  # ":"
                total += VariableTruncator.calculate_json_size(value[key], depth=depth + 1)
            return total
        elif isinstance(value, File):
            return VariableTruncator.calculate_json_size(value.model_dump(), depth=depth + 1)
        else:
            raise UnknownTypeError(f"got unknown type {type(value)}")

    def _truncate_string(self, value: str, target_size: int) -> _PartResult[str]:
        if (size := self.calculate_json_size(value)) < target_size:
            return _PartResult(value, size, False)
        if target_size < 5:
            return _PartResult("...", 5, True)
        truncated_size = min(self._string_length_limit, target_size - 5)
        truncated_value = value[:truncated_size] + "..."
        return _PartResult(truncated_value, self.calculate_json_size(truncated_value), True)

    def _truncate_array(self, value: list[object], target_size: int) -> _PartResult[list[object]]:
        """
        Truncate array with correct strategy:
        1. First limit to 20 items
        2. If still too large, truncate individual items
        """

        truncated_value: list[object] = []
        truncated = False
        used_size = self.calculate_json_size([])

        target_length = self._array_element_limit

        for i, item in enumerate(value):
            # Dirty fix:
            # The output of `Start` node may contain list of `File` elements,
            # causing `AssertionError` while invoking `_truncate_json_primitives`.
            #
            # This check ensures that `list[File]` are handled separately
            if isinstance(item, File):
                truncated_value.append(item)
                continue
            if i >= target_length:
                return _PartResult(truncated_value, used_size, True)
            if i > 0:
                used_size += 1  # Account for comma

            if used_size > target_size:
                break

            remaining_budget = target_size - used_size
            if item is None or isinstance(item, (str, list, dict, bool, int, float, UpdatedVariable)):
                part_result = self._truncate_json_primitives(item, remaining_budget)
            else:
                raise UnknownTypeError(f"got unknown type {type(item)} in array truncation")
            truncated_value.append(part_result.value)
            used_size += part_result.value_size
            truncated = part_result.truncated
        return _PartResult(truncated_value, used_size, truncated)

    @classmethod
    def _maybe_qa_structure(cls, m: Mapping[str, Any]) -> bool:
        qa_chunks = m.get(_QAKeys.QA_CHUNKS)
        if qa_chunks is None:
            return False
        if not isinstance(qa_chunks, list):
            return False
        return True

    @classmethod
    def _maybe_parent_child_structure(cls, m: Mapping[str, Any]) -> bool:
        parent_mode = m.get(_PCKeys.PARENT_MODE)
        if parent_mode is None:
            return False
        if not isinstance(parent_mode, str):
            return False
        parent_child_chunks = m.get(_PCKeys.PARENT_CHILD_CHUNKS)
        if parent_child_chunks is None:
            return False
        if not isinstance(parent_child_chunks, list):
            return False

        return True

    def _truncate_object(self, mapping: Mapping[str, Any], target_size: int) -> _PartResult[Mapping[str, Any]]:
        """
        Truncate object with key preservation priority.

        Strategy:
        1. Keep all keys, truncate values to fit within budget
        2. If still too large, drop keys starting from the end
        """
        if not mapping:
            return _PartResult(mapping, self.calculate_json_size(mapping), False)

        truncated_obj = {}
        truncated = False
        used_size = self.calculate_json_size({})

        # Sort keys to ensure deterministic behavior
        sorted_keys = sorted(mapping.keys())

        for i, key in enumerate(sorted_keys):
            if used_size > target_size:
                # No more room for additional key-value pairs
                truncated = True
                break

            pair_size = 0

            if i > 0:
                pair_size += 1  # Account for comma

            # Calculate budget for this key-value pair
            # do not try to truncate keys, as we want to keep the structure of
            # object.
            key_size = self.calculate_json_size(key) + 1  # +1 for ":"
            pair_size += key_size
            remaining_pairs = len(sorted_keys) - i
            value_budget = max(0, (target_size - pair_size - used_size) // remaining_pairs)

            if value_budget <= 0:
                truncated = True
                break

            # Truncate the value to fit within budget
            value = mapping[key]
            if isinstance(value, Segment):
                value_result = self._truncate_segment(value, value_budget)
            else:
                value_result = self._truncate_json_primitives(mapping[key], value_budget)

            truncated_obj[key] = value_result.value
            pair_size += value_result.value_size
            used_size += pair_size

            if value_result.truncated:
                truncated = True

        return _PartResult(truncated_obj, used_size, truncated)

    @overload
    def _truncate_json_primitives(
        self, val: UpdatedVariable, target_size: int
    ) -> _PartResult[Mapping[str, object]]: ...

    @overload
    def _truncate_json_primitives(self, val: str, target_size: int) -> _PartResult[str]: ...

    @overload
    def _truncate_json_primitives(self, val: list[object], target_size: int) -> _PartResult[list[object]]: ...

    @overload
    def _truncate_json_primitives(self, val: dict[str, object], target_size: int) -> _PartResult[dict[str, object]]: ...

    @overload
    def _truncate_json_primitives(self, val: bool, target_size: int) -> _PartResult[bool]: ...  # type: ignore

    @overload
    def _truncate_json_primitives(self, val: int, target_size: int) -> _PartResult[int]: ...

    @overload
    def _truncate_json_primitives(self, val: float, target_size: int) -> _PartResult[float]: ...

    @overload
    def _truncate_json_primitives(self, val: None, target_size: int) -> _PartResult[None]: ...

    @overload
    def _truncate_json_primitives(self, val: File, target_size: int) -> _PartResult[File]: ...

    def _truncate_json_primitives(
        self,
        val: UpdatedVariable | File | str | list[object] | dict[str, object] | bool | int | float | None,
        target_size: int,
    ) -> _PartResult[Any]:
        """Truncate a value within an object to fit within budget."""
        if isinstance(val, UpdatedVariable):
            # TODO(Workflow): push UpdatedVariable normalization closer to its producer.
            return self._truncate_object(val.model_dump(), target_size)
        elif isinstance(val, str):
            return self._truncate_string(val, target_size)
        elif isinstance(val, list):
            return self._truncate_array(val, target_size)
        elif isinstance(val, dict):
            return self._truncate_object(val, target_size)
        elif isinstance(val, File):
            # File objects should not be truncated, return as-is
            return _PartResult(val, self.calculate_json_size(val), False)
        elif val is None or isinstance(val, (bool, int, float)):
            return _PartResult(val, self.calculate_json_size(val), False)
        else:
            raise AssertionError("this statement should be unreachable.")


class DummyVariableTruncator(BaseTruncator):
    """
    A no-op variable truncator that doesn't truncate any data.

    This is used for Service API calls where truncation should be disabled
    to maintain backward compatibility and provide complete data.
    """

    def truncate_variable_mapping(self, v: Mapping[str, Any]) -> tuple[Mapping[str, Any], bool]:
        """
        Return original mapping without truncation.

        Args:
            v: The variable mapping to process

        Returns:
            Tuple of (original_mapping, False) where False indicates no truncation occurred
        """
        return v, False

    def truncate(self, segment: Segment) -> TruncationResult:
        """
        Return original segment without truncation.

        Args:
            segment: The segment to process

        Returns:
            The original segment unchanged
        """
        # For Service API, we want to preserve the original segment
        # without any truncation, so just return it as-is
        return TruncationResult(result=segment, truncated=False)
