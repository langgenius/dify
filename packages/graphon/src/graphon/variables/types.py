from __future__ import annotations

from collections.abc import Mapping
from enum import StrEnum
from typing import TYPE_CHECKING, Any, assert_never

from graphon.file.models import File

if TYPE_CHECKING:
    from graphon.variables.segments import Segment


def _infer_scalar_segment_type(value: Any) -> SegmentType | None:
    match value:
        case None:
            inferred_type = SegmentType.NONE
        case bool():
            inferred_type = SegmentType.BOOLEAN
        case int():
            inferred_type = SegmentType.INTEGER
        case float():
            inferred_type = SegmentType.FLOAT
        case str():
            inferred_type = SegmentType.STRING
        case dict():
            inferred_type = SegmentType.OBJECT
        case File():
            inferred_type = SegmentType.FILE
        case _:
            inferred_type = None
    return inferred_type


def _is_group_value_valid(value: Any) -> bool:
    from .segment_group import SegmentGroup  # ruff:ignore[import-outside-top-level]
    from .segments import Segment  # ruff:ignore[import-outside-top-level]

    match value:
        case SegmentGroup():
            return all(isinstance(item, Segment) for item in value.value)
        case list():
            return all(isinstance(item, Segment) for item in value)
        case _:
            return False


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
    SECRET = "secret"  # ruff:ignore[hardcoded-password-string]

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
    def infer_segment_type(cls, value: Any) -> SegmentType | None:
        """Attempt to infer the `SegmentType` based on the Python type of the
        `value` parameter.

        Returns `None` if no appropriate `SegmentType` can be determined for
        the given `value`. For example, this may occur if the input is a
        generic Python object of type `object`.

        Returns:
            The inferred `SegmentType`, or `None` when no runtime type matches.

        Raises:
            ValueError: If an unsupported homogeneous list element type reaches the
                internal exhaustive match.

        """
        if isinstance(value, list):
            elem_types: set[SegmentType] = set()
            for item in value:
                segment_type = cls.infer_segment_type(item)
                if segment_type is None:
                    return None
                elem_types.add(segment_type)

            if len(elem_types) != 1:
                return (
                    SegmentType.ARRAY_NUMBER
                    if elem_types.issubset(_NUMERICAL_TYPES)
                    else SegmentType.ARRAY_ANY
                )
            if all(item.is_array_type() for item in elem_types):
                return SegmentType.ARRAY_ANY

            inferred_type = _ARRAY_SEGMENT_TYPE_BY_ELEMENT_TYPE.get(elem_types.pop())
            if inferred_type is None:
                msg = f"not supported value {value}"
                raise ValueError(msg)
            return inferred_type

        return _infer_scalar_segment_type(value)

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
        if array_validation == ArrayValidation.FIRST:
            return element_type.is_valid(value[0])
        return all(
            element_type.is_valid(i, array_validation=ArrayValidation.NONE)
            for i in value
        )

    def is_valid(
        self,
        value: Any,
        array_validation: ArrayValidation = ArrayValidation.ALL,
    ) -> bool:
        """Check if a value matches the segment type.
        Users of `SegmentType` should call this method, instead of using
        `isinstance` manually.

        Args:
            value: The value to validate
            array_validation: Validation strategy for array types
            (ignored for non-array types)

        Returns:
            True if the value matches the type under the given validation strategy

        """
        match self:
            case (
                SegmentType.ARRAY_ANY
                | SegmentType.ARRAY_STRING
                | SegmentType.ARRAY_NUMBER
                | SegmentType.ARRAY_OBJECT
                | SegmentType.ARRAY_FILE
                | SegmentType.ARRAY_BOOLEAN
            ):
                result = self._validate_array(value, array_validation)
            case SegmentType.GROUP:
                result = _is_group_value_valid(value)
            case SegmentType.BOOLEAN:
                result = isinstance(value, bool)
            case SegmentType.NUMBER | SegmentType.INTEGER | SegmentType.FLOAT:
                result = isinstance(value, (int, float))
            case SegmentType.STRING | SegmentType.SECRET:
                result = isinstance(value, str)
            case SegmentType.OBJECT:
                result = isinstance(value, dict)
            case SegmentType.FILE:
                result = isinstance(value, File)
            case SegmentType.NONE:
                result = value is None
            case _:
                assert_never(self)
        return result

    @staticmethod
    def cast_value(value: Any, type_: SegmentType) -> Any:
        # Cast Python's `bool` type to `int` when the runtime type requires
        # an integer or number.
        #
        # This ensures compatibility with existing workflows that may use `bool` as
        # `int`, since in Python's type system, `bool` is a subtype of `int`.
        #
        # This function exists solely to maintain compatibility with existing workflows.
        # It should not be used to compromise the integrity of the runtime type system.
        # No additional casting rules should be introduced to this function.

        if type_ in _BOOL_CASTABLE_TYPES and isinstance(value, bool):
            return int(value)
        if type_ == SegmentType.ARRAY_NUMBER and all(
            isinstance(i, bool) for i in value
        ):
            return [int(i) for i in value]
        return value

    def exposed_type(self) -> SegmentType:
        """Returns the type exposed to the frontend.

        The frontend treats `INTEGER` and `FLOAT` as `NUMBER`,
        so these are returned as `NUMBER` here.

        Returns:
            The frontend-facing type for this runtime segment type.

        """
        if self in _EXPOSED_NUMBER_TYPES:
            return SegmentType.NUMBER
        return self

    def element_type(self) -> SegmentType | None:
        """Return the element type of the current segment type, or `None` if the
        element type is undefined.

        Returns:
            The array element `SegmentType`, or `None` when the array is untyped.

        Raises:
            ValueError: If the current segment type is not an array type.

        Note:
            For certain array types, such as `SegmentType.ARRAY_ANY`, their
            element types are not defined
            by the runtime system. In such cases, this method will return `None`.

        """
        if not self.is_array_type():
            msg = f"element_type is only supported by array type, got {self}"
            raise ValueError(msg)
        return _ARRAY_ELEMENT_TYPES_MAPPING.get(self)

    @staticmethod
    def get_zero_value(t: SegmentType) -> Segment:
        # Lazy import to avoid circular dependency between segment types
        # and factory helpers.
        from .factory import (  # ruff:ignore[import-outside-top-level]
            build_segment,
            build_segment_with_type,
        )

        if t in _EMPTY_ARRAY_ZERO_VALUE_TYPES:
            return build_segment_with_type(t, [])

        zero_value = _SCALAR_ZERO_VALUES_BY_SEGMENT_TYPE.get(t)
        if zero_value is None:
            msg = f"unsupported variable type: {t}"
            raise ValueError(msg)
        return build_segment(zero_value)


_ARRAY_SEGMENT_TYPE_BY_ELEMENT_TYPE: Mapping[SegmentType, SegmentType] = {
    SegmentType.STRING: SegmentType.ARRAY_STRING,
    SegmentType.NUMBER: SegmentType.ARRAY_NUMBER,
    SegmentType.INTEGER: SegmentType.ARRAY_NUMBER,
    SegmentType.FLOAT: SegmentType.ARRAY_NUMBER,
    SegmentType.OBJECT: SegmentType.ARRAY_OBJECT,
    SegmentType.FILE: SegmentType.ARRAY_FILE,
    SegmentType.NONE: SegmentType.ARRAY_ANY,
    SegmentType.BOOLEAN: SegmentType.ARRAY_BOOLEAN,
}
_EMPTY_ARRAY_ZERO_VALUE_TYPES = frozenset((
    SegmentType.ARRAY_OBJECT,
    SegmentType.ARRAY_ANY,
    SegmentType.ARRAY_STRING,
    SegmentType.ARRAY_NUMBER,
    SegmentType.ARRAY_BOOLEAN,
))
_SCALAR_ZERO_VALUES_BY_SEGMENT_TYPE: Mapping[
    SegmentType,
    dict[Any, Any] | str | int | float | bool,
] = {
    SegmentType.OBJECT: {},
    SegmentType.STRING: "",
    SegmentType.INTEGER: 0,
    SegmentType.FLOAT: 0.0,
    SegmentType.NUMBER: 0,
    SegmentType.BOOLEAN: False,
}


_ARRAY_ELEMENT_TYPES_MAPPING: Mapping[SegmentType, SegmentType] = {
    # ARRAY_ANY does not have corresponding element type.
    SegmentType.ARRAY_STRING: SegmentType.STRING,
    SegmentType.ARRAY_NUMBER: SegmentType.NUMBER,
    SegmentType.ARRAY_OBJECT: SegmentType.OBJECT,
    SegmentType.ARRAY_FILE: SegmentType.FILE,
    SegmentType.ARRAY_BOOLEAN: SegmentType.BOOLEAN,
}

_ARRAY_TYPES = frozenset([
    *_ARRAY_ELEMENT_TYPES_MAPPING.keys(),
    SegmentType.ARRAY_ANY,
])

_NUMERICAL_TYPES = frozenset([
    SegmentType.NUMBER,
    SegmentType.INTEGER,
    SegmentType.FLOAT,
])

_BOOL_CASTABLE_TYPES = frozenset([
    SegmentType.INTEGER,
    SegmentType.NUMBER,
])

_EXPOSED_NUMBER_TYPES = frozenset([
    SegmentType.INTEGER,
    SegmentType.FLOAT,
])
