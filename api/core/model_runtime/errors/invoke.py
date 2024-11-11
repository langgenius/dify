from typing import Optional


class InvokeError(Exception):
    """Base class for all LLM exceptions."""

    description: Optional[str] = None

    def __init__(self, description: Optional[str] = None) -> None:
        self.description = description

    def __str__(self):
        return self.description or self.__class__.__name__


class InvokeConnectionError(InvokeError):
    """Raised when the Invoke returns connection error."""

    description = "Connection Error"


class InvokeServerUnavailableError(InvokeError):
    """Raised when the Invoke returns server unavailable error."""

    description = "Server Unavailable Error"


class InvokeRateLimitError(InvokeError):
    """Raised when the Invoke returns rate limit error."""

    description = "Rate Limit Error"


class InvokeAuthorizationError(InvokeError):
    """Raised when the Invoke returns authorization error."""

    description = "Incorrect model credentials provided, please check and try again. "


class InvokeBadRequestError(InvokeError):
    """Raised when the Invoke returns bad request."""

    description = "Bad Request Error"
