from collections.abc import Mapping
from enum import StrEnum
from typing import Any, Optional

from core.file.models import File


class ArrayValidation(StrEnum):
    """Strategy for validating array elements.

    Note:
        The `NONE` and `FIRST` strategies are primarily for compatibility purposes.
        Avoid using them in new code whenever possible.
    """

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
    BOOLEAN = "boolean"

    ARRAY_ANY = "array[any]"
    ARRAY_STRING = "array[string]"
    ARRAY_NUMBER = "array[number]"
    ARRAY_OBJECT = "array[object]"
    ARRAY_FILE = "array[file]"
    ARRAY_BOOLEAN = "array[boolean]"

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
                case SegmentType.BOOLEAN:
                    return SegmentType.ARRAY_BOOLEAN
                case _:
                    # This should be unreachable.
                    raise ValueError(f"not supported value {value}")
        if value is None:
            return SegmentType.NONE
        # Important: The check for `bool` must precede the check for `int`,
        # as `bool` is a subclass of `int` in Python's type hierarchy.
        elif isinstance(value, bool):
            return SegmentType.BOOLEAN
        elif isinstance(value, int):
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
            return all(element_type.is_valid(i, array_validation=ArrayValidation.NONE) for i in value)

    def is_valid(self, value: Any, array_validation: ArrayValidation = ArrayValidation.ALL) -> bool:
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
        # Important: The check for `bool` must precede the check for `int`,
        # as `bool` is a subclass of `int` in Python's type hierarchy.
        elif self == SegmentType.BOOLEAN:
            return isinstance(value, bool)
        elif self in [SegmentType.INTEGER, SegmentType.FLOAT, SegmentType.NUMBER]:
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

    @staticmethod
    def cast_value(value: Any, type_: "SegmentType"):
        # Cast Python's `bool` type to `int` when the runtime type requires
        # an integer or number.
        #
        # This ensures compatibility with existing workflows that may use `bool` as
        # `int`, since in Python's type system, `bool` is a subtype of `int`.
        #
        # This function exists solely to maintain compatibility with existing workflows.
        # It should not be used to compromise the integrity of the runtime type system.
        # No additional casting rules should be introduced to this function.

        if type_ in (
            SegmentType.INTEGER,
            SegmentType.NUMBER,
        ) and isinstance(value, bool):
            return int(value)
        if type_ == SegmentType.ARRAY_NUMBER and all(isinstance(i, bool) for i in value):
            return [int(i) for i in value]
        return value

    def exposed_type(self) -> "SegmentType":
        """Returns the type exposed to the frontend.

        The frontend treats `INTEGER` and `FLOAT` as `NUMBER`, so these are returned as `NUMBER` here.
        """
        if self in (SegmentType.INTEGER, SegmentType.FLOAT):
            return SegmentType.NUMBER
        return self

    def element_type(self) -> "SegmentType | None":
        """Return the element type of the current segment type, or `None` if the element type is undefined.

        Raises:
            ValueError: If the current segment type is not an array type.

        Note:
            For certain array types, such as `SegmentType.ARRAY_ANY`, their element types are not defined
            by the runtime system. In such cases, this method will return `None`.
        """
        if not self.is_array_type():
            raise ValueError(f"element_type is only supported by array type, got {self}")
        return _ARRAY_ELEMENT_TYPES_MAPPING.get(self)


_ARRAY_ELEMENT_TYPES_MAPPING: Mapping[SegmentType, SegmentType] = {
    # ARRAY_ANY does not have corresponding element type.
    SegmentType.ARRAY_STRING: SegmentType.STRING,
    SegmentType.ARRAY_NUMBER: SegmentType.NUMBER,
    SegmentType.ARRAY_OBJECT: SegmentType.OBJECT,
    SegmentType.ARRAY_FILE: SegmentType.FILE,
    SegmentType.ARRAY_BOOLEAN: SegmentType.BOOLEAN,
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
