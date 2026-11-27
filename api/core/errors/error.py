class LLMError(ValueError):
    """Base class for all LLM exceptions."""

    description: str = ""

    def __init__(self, description: str = ""):
        self.description = description


class LLMBadRequestError(LLMError):
    """Raised when the LLM returns bad request."""

    description = "Bad Request"


class ProviderTokenNotInitError(ValueError):
    """
    Custom exception raised when the provider token is not initialized.
    """

    description = "Provider Token Not Init"

    def __init__(self, *args: object, **kwargs: object):
        self.description = str(args[0]) if args else self.description


class QuotaExceededError(ValueError):
    """
    Custom exception raised when the quota for a provider has been exceeded.
    """

    description = "Quota Exceeded"


class InsufficientHostedCreditsError(QuotaExceededError):
    """Billing declined the full hosted-credit reservation without charging or reserving credits."""


class AppInvokeQuotaExceededError(ValueError):
    """
    Custom exception raised when the quota for an app has been exceeded.
    """

    description = "App Invoke Quota Exceeded"


class AppInvokeQuotaWaitTimeoutError(TimeoutError):
    """Raised when a caller cannot acquire an app concurrency slot in time."""


class ModelCurrentlyNotSupportError(ValueError):
    """
    Custom exception raised when the model not support
    """

    description = "Model Currently Not Support"


class InvokeRateLimitError(ValueError):
    """Raised when the Invoke returns rate limit error."""

    description = "Rate Limit Error"
