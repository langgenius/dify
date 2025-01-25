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
