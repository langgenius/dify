from collections.abc import Mapping
from enum import StrEnum
from typing import Any, Optional

from core.file.models import File


class ArrayValidation(StrEnum):
    """Strategy for validating array elements"""

    # Skip element validation (only check array container)
    NONE = "none"

    # Validate the first element (if array is non-empty)
    FIRST = "first"

    # Validate all elements in the array.
    ALL = "all"


class SegmentType(StrEnum):
    NUMBER = "number"
    INTEGER = "integer"
    FLOAT = "float"
    STRING = "string"
    OBJECT = "object"
    SECRET = "secret"

    FILE = "file"

    ARRAY_ANY = "array[any]"
    ARRAY_STRING = "array[string]"
    ARRAY_NUMBER = "array[number]"
    ARRAY_OBJECT = "array[object]"
    ARRAY_FILE = "array[file]"

    NONE = "none"

    GROUP = "group"

    def is_array_type(self) -> bool:
        return self in _ARRAY_TYPES

    @classmethod
    def infer_segment_type(cls, value: Any) -> Optional["SegmentType"]:
        """
        Attempt to infer the `SegmentType` based on the Python type of the `value` parameter.

        Returns `None` if no appropriate `SegmentType` can be determined for the given `value`.
        For example, this may occur if the input is a generic Python object of type `object`.
        """

        if isinstance(value, list):
            elem_types: set[SegmentType] = set()
            for i in value:
                segment_type = cls.infer_segment_type(i)
                if segment_type is None:
                    return None

                elem_types.add(segment_type)

            if len(elem_types) != 1:
                if elem_types.issubset(_NUMERICAL_TYPES):
                    return SegmentType.ARRAY_NUMBER
                return SegmentType.ARRAY_ANY
            elif all(i.is_array_type() for i in elem_types):
                return SegmentType.ARRAY_ANY
            match elem_types.pop():
                case SegmentType.STRING:
                    return SegmentType.ARRAY_STRING
                case SegmentType.NUMBER | SegmentType.INTEGER | SegmentType.FLOAT:
                    return SegmentType.ARRAY_NUMBER
                case SegmentType.OBJECT:
                    return SegmentType.ARRAY_OBJECT
                case SegmentType.FILE:
                    return SegmentType.ARRAY_FILE
                case SegmentType.NONE:
                    return SegmentType.ARRAY_ANY
                case _:
                    # This should be unreachable.
                    raise ValueError(f"not supported value {value}")
        if value is None:
            return SegmentType.NONE
        elif isinstance(value, int) and not isinstance(value, bool):
            return SegmentType.INTEGER
        elif isinstance(value, float):
            return SegmentType.FLOAT
        elif isinstance(value, str):
            return SegmentType.STRING
        elif isinstance(value, dict):
            return SegmentType.OBJECT
        elif isinstance(value, File):
            return SegmentType.FILE
        else:
            return None

    def _validate_array(self, value: Any, array_validation: ArrayValidation) -> bool:
        if not isinstance(value, list):
            return False
        # Skip element validation if array is empty
        if len(value) == 0:
            return True
        if self == SegmentType.ARRAY_ANY:
            return True
        element_type = _ARRAY_ELEMENT_TYPES_MAPPING[self]

        if array_validation == ArrayValidation.NONE:
            return True
        elif array_validation == ArrayValidation.FIRST:
            return element_type.is_valid(value[0])
        else:
            return all([element_type.is_valid(i, array_validation=ArrayValidation.NONE)] for i in value)

    def is_valid(self, value: Any, array_validation: ArrayValidation = ArrayValidation.FIRST) -> bool:
        """
        Check if a value matches the segment type.
        Users of `SegmentType` should call this method, instead of using
        `isinstance` manually.

        Args:
            value: The value to validate
            array_validation: Validation strategy for array types (ignored for non-array types)

        Returns:
            True if the value matches the type under the given validation strategy
        """
        if self.is_array_type():
            return self._validate_array(value, array_validation)
        elif self == SegmentType.NUMBER:
            return isinstance(value, (int, float))
        elif self == SegmentType.STRING:
            return isinstance(value, str)
        elif self == SegmentType.OBJECT:
            return isinstance(value, dict)
        elif self == SegmentType.SECRET:
            return isinstance(value, str)
        elif self == SegmentType.FILE:
            return isinstance(value, File)
        elif self == SegmentType.NONE:
            return value is None
        else:
            raise AssertionError("this statement should be unreachable.")

    def exposed_type(self) -> "SegmentType":
        """Returns the type exposed to the frontend.

        The frontend treats `INTEGER` and `FLOAT` as `NUMBER`, so these are returned as `NUMBER` here.
        """
        if self in (SegmentType.INTEGER, SegmentType.FLOAT):
            return SegmentType.NUMBER
        return self


_ARRAY_ELEMENT_TYPES_MAPPING: Mapping[SegmentType, SegmentType] = {
    # ARRAY_ANY does not have correpond element type.
    SegmentType.ARRAY_STRING: SegmentType.STRING,
    SegmentType.ARRAY_NUMBER: SegmentType.NUMBER,
    SegmentType.ARRAY_OBJECT: SegmentType.OBJECT,
    SegmentType.ARRAY_FILE: SegmentType.FILE,
}

_ARRAY_TYPES = frozenset(
    list(_ARRAY_ELEMENT_TYPES_MAPPING.keys())
    + [
        SegmentType.ARRAY_ANY,
    ]
)


_NUMERICAL_TYPES = frozenset(
    [
        SegmentType.NUMBER,
        SegmentType.INTEGER,
        SegmentType.FLOAT,
    ]
)
