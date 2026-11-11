class AppGenerateError(ValueError):
    """Base class for application-generation errors with a stable response contract."""

    error_code: str
    status_code: int


class ModerationInvocationError(AppGenerateError):
    """A model moderation failure that consumers must not downgrade to a best-effort result."""


class GenerateTaskStoppedError(Exception):
    pass
