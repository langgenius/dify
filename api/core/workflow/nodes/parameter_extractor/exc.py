from typing import Any

from core.variables.types import SegmentType


class ParameterExtractorNodeError(ValueError):
    """Base error for ParameterExtractorNode."""


class InvalidModelTypeError(ParameterExtractorNodeError):
    """Raised when the model is not a Large Language Model."""


class ModelSchemaNotFoundError(ParameterExtractorNodeError):
    """Raised when the model schema is not found."""


class InvalidInvokeResultError(ParameterExtractorNodeError):
    """Raised when the invoke result is invalid."""


class InvalidTextContentTypeError(ParameterExtractorNodeError):
    """Raised when the text content type is invalid."""


class InvalidNumberOfParametersError(ParameterExtractorNodeError):
    """Raised when the number of parameters is invalid."""


class RequiredParameterMissingError(ParameterExtractorNodeError):
    """Raised when a required parameter is missing."""


class InvalidSelectValueError(ParameterExtractorNodeError):
    """Raised when a select value is invalid."""


class InvalidNumberValueError(ParameterExtractorNodeError):
    """Raised when a number value is invalid."""


class InvalidBoolValueError(ParameterExtractorNodeError):
    """Raised when a bool value is invalid."""


class InvalidStringValueError(ParameterExtractorNodeError):
    """Raised when a string value is invalid."""


class InvalidArrayValueError(ParameterExtractorNodeError):
    """Raised when an array value is invalid."""


class InvalidModelModeError(ParameterExtractorNodeError):
    """Raised when the model mode is invalid."""


class InvalidValueTypeError(ParameterExtractorNodeError):
    def __init__(
        self,
        /,
        parameter_name: str,
        expected_type: SegmentType,
        actual_type: SegmentType | None,
        value: Any,
    ):
        message = (
            f"Invalid value for parameter {parameter_name}, expected segment type: {expected_type}, "
            f"actual_type: {actual_type}, python_type: {type(value)}, value: {value}"
        )
        super().__init__(message)
        self.parameter_name = parameter_name
        self.expected_type = expected_type
        self.actual_type = actual_type
        self.value = value
