class AppGenerateError(ValueError):
    """Base class for application-generation errors with a stable response contract."""

    error_code: str
    status_code: int


class GenerateTaskStoppedError(Exception):
    pass
