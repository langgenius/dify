from core.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)


def invoke_error_mapping() -> dict[type[InvokeError], list[type[Exception]]]:
    """
    Map model invoke error to unified error
    The key is the error type thrown to the caller
    The value is the error type thrown by the model,
    which needs to be converted into a unified error type for the caller.

    :return: Invoke error mapping
    """
    return {
        InvokeConnectionError: [],
        InvokeServerUnavailableError: [InternalServerError],
        InvokeRateLimitError: [RateLimitReachedError],
        InvokeAuthorizationError: [
            InvalidAuthenticationError,
            InsufficientAccountBalanceError,
            InvalidAPIKeyError,
        ],
        InvokeBadRequestError: [BadRequestError, KeyError],
    }


class InvalidAuthenticationError(Exception):
    pass


class InvalidAPIKeyError(Exception):
    pass


class RateLimitReachedError(Exception):
    pass


class InsufficientAccountBalanceError(Exception):
    pass


class InternalServerError(Exception):
    pass


class BadRequestError(Exception):
    pass
