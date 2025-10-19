from libs.exception import BaseHTTPException


class AppUnavailableError(BaseHTTPException):
    error_code = "app_unavailable"
    description = "App unavailable, please check your app configurations."
    code = 400


class NotCompletionAppError(BaseHTTPException):
    error_code = "not_completion_app"
    description = "Please check if your Completion app mode matches the right API route."
    code = 400


class NotChatAppError(BaseHTTPException):
    error_code = "not_chat_app"
    description = "Please check if your app mode matches the right API route."
    code = 400


class NotWorkflowAppError(BaseHTTPException):
    error_code = "not_workflow_app"
    description = "Please check if your app mode matches the right API route."
    code = 400


class ConversationCompletedError(BaseHTTPException):
    error_code = "conversation_completed"
    description = "The conversation has ended. Please start a new conversation."
    code = 400


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
        "Your quota for Dify Hosted OpenAI has been exhausted. "
        "Please go to Settings -> Model Provider to complete your own provider credentials."
    )
    code = 400


class ProviderModelCurrentlyNotSupportError(BaseHTTPException):
    error_code = "model_currently_not_support"
    description = "Dify Hosted OpenAI trial currently not support the GPT-4 model."
    code = 400


class CompletionRequestError(BaseHTTPException):
    error_code = "completion_request_error"
    description = "Completion request failed."
    code = 400


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


class FileNotFoundError(BaseHTTPException):
    error_code = "file_not_found"
    description = "The requested file was not found."
    code = 404


class FileAccessDeniedError(BaseHTTPException):
    error_code = "file_access_denied"
    description = "Access to the requested file is denied."
    code = 403
