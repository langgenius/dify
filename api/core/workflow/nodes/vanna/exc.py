class VannaNodeError(ValueError):
    """Base error for VannaNode."""


class InvalidModelTypeError(VannaNodeError):
    """Raised when the model is not a Large Language Model."""


class ModelSchemaNotFoundError(VannaNodeError):
    """Raised when the model schema is not found."""


class InvalidInvokeResultError(VannaNodeError):
    """Raised when the invoke result is invalid."""


class InvalidTextContentTypeError(VannaNodeError):
    """Raised when the text content type is invalid."""


class InvalidNumberOfParametersError(VannaNodeError):
    """Raised when the number of parameters is invalid."""


class RequiredParameterMissingError(VannaNodeError):
    """Raised when a required parameter is missing."""


class InvalidSelectValueError(VannaNodeError):
    """Raised when a select value is invalid."""


class InvalidNumberValueError(VannaNodeError):
    """Raised when a number value is invalid."""


class InvalidBoolValueError(VannaNodeError):
    """Raised when a bool value is invalid."""


class InvalidStringValueError(VannaNodeError):
    """Raised when a string value is invalid."""


class InvalidArrayValueError(VannaNodeError):
    """Raised when an array value is invalid."""


class InvalidModelModeError(VannaNodeError):
    """Raised when the model mode is invalid."""
