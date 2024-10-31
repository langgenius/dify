class DSLVersionNotSupportedError(ValueError):
    """Raised when the imported DSL version is not supported by the current Dify version."""


class InvalidYAMLFormatError(ValueError):
    """Raised when the provided YAML format is invalid."""


class MissingAppDataError(ValueError):
    """Raised when the app data is missing in the provided DSL."""


class InvalidAppModeError(ValueError):
    """Raised when the app mode is invalid."""


class MissingWorkflowDataError(ValueError):
    """Raised when the workflow data is missing in the provided DSL."""


class MissingModelConfigError(ValueError):
    """Raised when the model config data is missing in the provided DSL."""


class FileSizeLimitExceededError(ValueError):
    """Raised when the file size exceeds the allowed limit."""


class EmptyContentError(ValueError):
    """Raised when the content fetched from the URL is empty."""


class ContentDecodingError(ValueError):
    """Raised when there is an error decoding the content."""
