from core.app.apps.agent_app.errors import (
    AGENT_SESSION_CONFIGURATION_CHANGED_ERROR_CODE,
    AGENT_SESSION_CONFIGURATION_CHANGED_MESSAGE,
)
from libs.exception import BaseHTTPException


class AppNotFoundError(BaseHTTPException):
    error_code = "app_not_found"
    description = "App not found."
    code = 404


class ProviderNotInitializeError(BaseHTTPException):
    error_code = "provider_not_initialize"
    description = (
        "No valid model provider credentials found. "
        "Please go to Settings -> Model Provider to complete your provider credentials."
    )
    code = 400


class ProviderQuotaExceededError(BaseHTTPException):
    error_code = "provider_quota_exceeded"
    description = (
        "Your quota for Dify Hosted Model Provider has been exhausted. "
        "Please go to Settings -> Model Provider to complete your own provider credentials."
    )
    code = 400


class ProviderModelCurrentlyNotSupportError(BaseHTTPException):
    error_code = "model_currently_not_support"
    description = "Dify Hosted OpenAI trial currently not support the GPT-4 model."
    code = 400


class ConversationCompletedError(BaseHTTPException):
    error_code = "conversation_completed"
    description = "The conversation has ended. Please start a new conversation."
    code = 400


class AppUnavailableError(BaseHTTPException):
    error_code = "app_unavailable"
    description = "App unavailable, please check your app configurations."
    code = 400


class CompletionRequestError(BaseHTTPException):
    error_code = "completion_request_error"
    description = "Completion request failed."
    code = 400


class AgentSessionConfigurationChangedError(BaseHTTPException):
    error_code = AGENT_SESSION_CONFIGURATION_CHANGED_ERROR_CODE
    description = AGENT_SESSION_CONFIGURATION_CHANGED_MESSAGE
    code = 409


class AppMoreLikeThisDisabledError(BaseHTTPException):
    error_code = "app_more_like_this_disabled"
    description = "The 'More like this' feature is disabled. Please refresh your page."
    code = 403


class NoAudioUploadedError(BaseHTTPException):
    error_code = "no_audio_uploaded"
    description = "Please upload your audio."
    code = 400


class AudioTooLargeError(BaseHTTPException):
    error_code = "audio_too_large"
    description = "Audio size exceeded. {message}"
    code = 413


class UnsupportedAudioTypeError(BaseHTTPException):
    error_code = "unsupported_audio_type"
    description = "Audio type not allowed."
    code = 415


class ProviderNotSupportSpeechToTextError(BaseHTTPException):
    error_code = "provider_not_support_speech_to_text"
    description = "Provider not support speech to text."
    code = 400


class SpeechToTextDisabledError(BaseHTTPException):
    error_code = "speech_to_text_disabled"
    description = "Speech to text is disabled."
    code = 400


class DraftWorkflowNotExist(BaseHTTPException):
    error_code = "draft_workflow_not_exist"
    description = "Draft workflow need to be initialized."
    code = 404


class DraftWorkflowNotSync(BaseHTTPException):
    error_code = "draft_workflow_not_sync"
    description = "Workflow graph might have been modified, please refresh and resubmit."
    code = 409


class TracingConfigNotFoundError(BaseHTTPException):
    error_code = "trace_config_not_found"
    description = "Tracing configuration not found."
    code = 404


class TracingConfigAlreadyExistsError(BaseHTTPException):
    error_code = "trace_config_already_exists"
    description = "A tracing configuration already exists for this provider."
    code = 409


class UnsupportedTracingProviderError(BaseHTTPException):
    error_code = "unsupported_tracing_provider"
    description = "The tracing provider is not supported."
    code = 400


class InvalidTracingConfigError(BaseHTTPException):
    error_code = "invalid_tracing_config"
    description = "The tracing configuration is invalid."
    code = 400


class TracingConfigVerificationFailedError(BaseHTTPException):
    error_code = "tracing_config_verification_failed"
    description = "The tracing configuration could not be verified."
    code = 400


class TracingConfigProcessingError(BaseHTTPException):
    error_code = "tracing_config_processing_failed"
    description = "The tracing configuration could not be processed."
    code = 500


class InvokeRateLimitError(BaseHTTPException):
    """Raised when the Invoke returns rate limit error."""

    error_code = "rate_limit_error"
    description = "Rate Limit Error"
    code = 429


class NeedAddIdsError(BaseHTTPException):
    error_code = "need_add_ids"
    description = "Need to add ids."
    code = 400
