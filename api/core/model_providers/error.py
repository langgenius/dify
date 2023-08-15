from typing import Optional


class LLMError(Exception):
    """Base class for all LLM exceptions."""
    description: Optional[str] = None

    def __init__(self, description: Optional[str] = None) -> None:
        self.description = description


class LLMBadRequestError(LLMError):
    """Raised when the LLM returns bad request."""
    description = "Bad Request"


class LLMAPIConnectionError(LLMError):
    """Raised when the LLM returns API connection error."""
    description = "API Connection Error"


class LLMAPIUnavailableError(LLMError):
    """Raised when the LLM returns API unavailable error."""
    description = "API Unavailable Error"


class LLMRateLimitError(LLMError):
    """Raised when the LLM returns rate limit error."""
    description = "Rate Limit Error"


class LLMAuthorizationError(LLMError):
    """Raised when the LLM returns authorization error."""
    description = "Authorization Error"


class ProviderTokenNotInitError(Exception):
    """
    Custom exception raised when the provider token is not initialized.
    """
    description = "Provider Token Not Init"

    def __init__(self, *args, **kwargs):
        self.description = args[0] if args else self.description


class QuotaExceededError(Exception):
    """
    Custom exception raised when the quota for a provider has been exceeded.
    """
    description = "Quota Exceeded"


class ModelCurrentlyNotSupportError(Exception):
    """
    Custom exception raised when the model not support
    """
    description = "Model Currently Not Support"
