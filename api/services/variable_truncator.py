import dataclasses
import json
from collections.abc import Mapping
from typing import Any, TypeAlias

from configs import dify_config
from core.variables.segments import (
    ArrayFileSegment,
    ArraySegment,
    FileSegment,
    FloatSegment,
    IntegerSegment,
    NoneSegment,
    ObjectSegment,
    Segment,
    StringSegment,
)

LARGE_VARIABLE_THRESHOLD = 10 * 1024  # 100KB in bytes
OBJECT_CHAR_LIMIT = 5000
ARRAY_CHAR_LIMIT = 1000

_MAX_DEPTH = 20


class MaxDepthExceededError(Exception):
    pass


class UnknownTypeError(Exception):
    pass


JSONTypes: TypeAlias = int | float | str | list | dict | None | bool


@dataclasses.dataclass(frozen=True)
class TruncationResult:
    result: Segment
    truncated: bool


class VariableTruncator:
    """
    Handles variable truncation with structure-preserving strategies.

    This class implements intelligent truncation that prioritizes maintaining data structure
    integrity while ensuring the final size doesn't exceed specified limits.

    Uses recursive size calculation to avoid repeated JSON serialization.
    """

    _JSON_SEPARATORS = (",", ":")

    def __init__(
        self,
        string_length_limit=5000,
        array_element_limit: int = 20,
        max_size_bytes: int = LARGE_VARIABLE_THRESHOLD,
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
    def default(cls) -> "VariableTruncator":
        return VariableTruncator(
            max_size_bytes=dify_config.WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE,
            array_element_limit=dify_config.WORKFLOW_VARIABLE_TRUNCATION_ARRAY_LENGTH,
            string_length_limit=dify_config.WORKFLOW_VARIABLE_TRUNCATION_STRING_LENGTH,
        )

    def truncate_io_mapping(self, v: Mapping[str, Any]) -> tuple[Mapping[str, Any], bool]:
        """`truncate_inputs_output` is used to truncate the `inputs` / `outputs` of a WorkflowNodeExecution record."""
        size = self.calculate_json_size(v)
        if size < self._max_size_bytes:
            return v, False
        budget = self._max_size_bytes
        is_truncated = False
        truncated_mapping: dict[str, Any] = {}
        size = len(v.items())
        remaining = size
        for key, value in v.items():
            budget -= self.calculate_json_size(key)
            if budget < 0:
                break
            truncated_value, value_truncated = self._truncate_value_to_budget(value, budget // remaining)
            if value_truncated:
                is_truncated = True
            truncated_mapping[key] = truncated_value
            # TODO(QuantumGhost): This approach is inefficient. Ideally, the truncation function should directly
            # report the size of the truncated value.
            budget -= self.calculate_json_size(truncated_value) + 2  # ":" and ","
        return truncated_mapping, is_truncated

    def truncate(self, segment: Segment) -> TruncationResult:
        """
        Apply smart truncation to a variable value.

        Args:
            value: The value to truncate (can be Segment or raw value)

        Returns:
            TruncationResult with truncated data and truncation status
        """

        if isinstance(segment, IntegerSegment):
            if isinstance(segment.value, bool):
                # TODO: here we need to support boolean types here
                return TruncationResult(result=IntegerSegment(value=int(segment.value)), truncated=False)
            return TruncationResult(result=segment, truncated=False)
        # we don't truncate ArrayFileSegment, as the number of files in one variable is relatiely small.
        elif isinstance(segment, (NoneSegment, FloatSegment, FileSegment, ArrayFileSegment)):
            return TruncationResult(result=segment, truncated=False)

        # Apply type-specific truncation with target size
        if isinstance(segment, ArraySegment):
            truncated_value, was_truncated = self._truncate_array(segment.value, self._max_size_bytes)
        elif isinstance(segment, StringSegment):
            truncated_value, was_truncated = self._truncate_string(segment.value)
        elif isinstance(segment, ObjectSegment):
            truncated_value, was_truncated = self._truncate_object(segment.value, self._max_size_bytes)
        else:
            raise AssertionError("this should be unreachable.")

        # Check if we still exceed the final character limit after type-specific truncation
        if not was_truncated:
            return TruncationResult(result=segment, truncated=False)

        truncated_size = self.calculate_json_size(truncated_value)
        if truncated_size > self._max_size_bytes:
            if isinstance(truncated_value, str):
                return TruncationResult(StringSegment(value=truncated_value[: self._max_size_bytes - 3]), True)
            # Apply final fallback - convert to JSON string and truncate
            json_str = json.dumps(truncated_value, ensure_ascii=False, separators=self._JSON_SEPARATORS)
            if len(json_str) > self._max_size_bytes:
                json_str = json_str[: self._max_size_bytes] + "..."
            return TruncationResult(result=StringSegment(value=json_str), truncated=True)

        return TruncationResult(result=segment.model_copy(update={"value": truncated_value}), truncated=True)

    @staticmethod
    def calculate_json_size(value: Any, depth=0) -> int:
        """Recursively calculate JSON size without serialization."""
        if depth > _MAX_DEPTH:
            raise MaxDepthExceededError()
        if isinstance(value, str):
            # For strings, we need to account for escaping and quotes
            # Rough estimate: each character might need escaping, plus 2 for quotes
            return len(value.encode("utf-8")) + 2
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
        else:
            raise UnknownTypeError(f"got unknown type {type(value)}")

    def _truncate_string(self, value: str) -> tuple[str, bool]:
        """Truncate string values."""
        if len(value) <= self._string_length_limit:
            return value, False
        return value[: self._string_length_limit - 3] + "...", True

    def _truncate_array(self, value: list, target_size: int) -> tuple[list, bool]:
        """
        Truncate array with correct strategy:
        1. First limit to 20 items
        2. If still too large, truncate individual items
        """

        # Step 1: Limit to first 20 items
        limited_items = value[: self._array_element_limit]
        was_truncated = len(limited_items) < len(value)

        # Step 2: Check if we still exceed the target size
        current_size = self.calculate_json_size(limited_items)
        if current_size <= target_size:
            return limited_items, was_truncated

        # Step 3: Truncate individual items to fit within target size
        truncated_items = []
        remaining_size = target_size - 2  # Account for []

        for i, item in enumerate(limited_items):
            if i > 0:
                remaining_size -= 1  # Account for comma

            if remaining_size <= 0:
                break

            # Calculate how much space this item can use
            remaining_items = len(limited_items) - i
            item_budget = remaining_size // remaining_items

            # Truncate the item to fit within budget
            truncated_item, item_truncated = self._truncate_item_to_budget(item, item_budget)
            truncated_items.append(truncated_item)

            # Update remaining size
            item_size = self.calculate_json_size(truncated_item)
            remaining_size -= item_size

            if item_truncated:
                was_truncated = True

        return truncated_items, True

    def _truncate_object(self, value: Mapping[str, Any], target_size: int) -> tuple[Mapping[str, Any], bool]:
        """
        Truncate object with key preservation priority.

        Strategy:
        1. Keep all keys, truncate values to fit within budget
        2. If still too large, drop keys starting from the end
        """
        if not value:
            return value, False

        truncated_obj = {}
        was_truncated = False
        remaining_size = target_size - 2  # Account for {}

        # Sort keys to ensure deterministic behavior
        sorted_keys = sorted(value.keys())

        for i, key in enumerate(sorted_keys):
            val = value[key]

            if i > 0:
                remaining_size -= 1  # Account for comma

            if remaining_size <= 0:
                # No more room for additional key-value pairs
                was_truncated = True
                break

            # Calculate budget for this key-value pair
            key_size = self.calculate_json_size(str(key)) + 1  # +1 for ":"
            remaining_pairs = len(sorted_keys) - i
            value_budget = max(0, (remaining_size - key_size) // remaining_pairs)

            if value_budget <= 0:
                was_truncated = True
                break

            # Truncate the value to fit within budget
            truncated_val, val_truncated = self._truncate_value_to_budget(val, value_budget)

            truncated_obj[key] = truncated_val
            if val_truncated:
                was_truncated = True

            # Update remaining size
            pair_size = key_size + self.calculate_json_size(truncated_val)
            remaining_size -= pair_size

        return truncated_obj, was_truncated or len(truncated_obj) < len(value)

    def _truncate_item_to_budget(self, item: Any, budget: int) -> tuple[Any, bool]:
        """Truncate an array item to fit within a size budget."""
        if isinstance(item, str):
            # For strings, truncate to fit within budget (accounting for quotes)
            max_chars = max(0, budget - 5)  # -5 for quotes and potential "..."
            max_chars = min(max_chars, ARRAY_CHAR_LIMIT)
            if len(item) <= max_chars:
                return item, False
            return item[:max_chars] + "...", True
        elif isinstance(item, dict):
            # For objects, recursively truncate
            return self._truncate_object(item, budget)
        elif isinstance(item, list):
            # For nested arrays, recursively truncate
            return self._truncate_array(item, budget)
        else:
            # For other types, check if they fit
            item_size = self.calculate_json_size(item)
            if item_size <= budget:
                return item, False
            else:
                # Convert to string and truncate
                str_item = str(item)
                return self._truncate_item_to_budget(str_item, budget)

    def _truncate_value_to_budget(self, val: Any, budget: int) -> tuple[Any, bool]:
        """Truncate a value within an object to fit within budget."""
        if isinstance(val, str):
            # For strings, respect OBJECT_CHAR_LIMIT but also budget
            max_chars = min(OBJECT_CHAR_LIMIT, max(0, budget - 5))  # -5 for quotes and "..."
            if len(val) <= max_chars:
                return val, False
            return val[:max_chars] + "...", True
        elif isinstance(val, list):
            return self._truncate_array(val, budget)
        elif isinstance(val, dict):
            return self._truncate_object(val, budget)
        else:
            # For other types, check if they fit
            val_size = self.calculate_json_size(val)
            if val_size <= budget:
                return val, False
            else:
                # Convert to string and truncate
                return self._truncate_value_to_budget(str(val), budget)
