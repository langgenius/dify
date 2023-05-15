from libs.exception import BaseHTTPException


class AppNotFoundError(BaseHTTPException):
    error_code = 'app_not_found'
    description = "App not found."
    code = 404


class ProviderNotInitializeError(BaseHTTPException):
    error_code = 'provider_not_initialize'
    description = "Provider Token not initialize."
    code = 400


class ProviderQuotaExceededError(BaseHTTPException):
    error_code = 'provider_quota_exceeded'
    description = "Provider quota exceeded."
    code = 400


class ProviderModelCurrentlyNotSupportError(BaseHTTPException):
    error_code = 'model_currently_not_support'
    description = "GPT-4 currently not support."
    code = 400


class ConversationCompletedError(BaseHTTPException):
    error_code = 'conversation_completed'
    description = "Conversation was completed."
    code = 400


class AppUnavailableError(BaseHTTPException):
    error_code = 'app_unavailable'
    description = "App unavailable."
    code = 400


class CompletionRequestError(BaseHTTPException):
    error_code = 'completion_request_error'
    description = "Completion request failed."
    code = 400


class AppMoreLikeThisDisabledError(BaseHTTPException):
    error_code = 'app_more_like_this_disabled'
    description = "More like this disabled."
    code = 403
