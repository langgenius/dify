from libs.exception import BaseHTTPException


class AppUnavailableError(BaseHTTPException):
    error_code = "app_unavailable"
    description = "App is currently unavailable. Please check your app configurations"
    code = 400


class NotCompletionAppError(BaseHTTPException):
    error_code = "not_completion_app"
    description = "This API route is for Completion apps only. Please verify your app mode and API endpoint"
    code = 400


class NotChatAppError(BaseHTTPException):
    error_code = "not_chat_app"
    description = "This API route is for Chat apps only. Please verify your app mode and API endpoint"
    code = 400


class NotWorkflowAppError(BaseHTTPException):
    error_code = "not_workflow_app"
    description = "This API route is for Workflow apps only. Please verify your app mode and API endpoint"
    code = 400


class ConversationCompletedError(BaseHTTPException):
    error_code = "conversation_completed"
    description = "This conversation has ended. Please initiate a new conversation"
    code = 400


class ProviderNotInitializeError(BaseHTTPException):
    error_code = "provider_not_initialize"
    description = (
        "No valid model provider credentials found. "
        "Please navigate to Settings -> Model Provider to set up your provider credentials"
    )
    code = 400


class ProviderQuotaExceededError(BaseHTTPException):
    error_code = "provider_quota_exceeded"
    description = (
        "Your quota for Dify Hosted OpenAI has been exhausted. "
        "Please navigate to Settings -> Model Provider to set up your own provider credentials"
    )
    code = 400


class ProviderModelCurrentlyNotSupportError(BaseHTTPException):
    error_code = "model_currently_not_support"
    description = "The Dify Hosted OpenAI trial does not currently support the GPT-4 model"
    code = 400


class CompletionRequestError(BaseHTTPException):
    error_code = "completion_request_error"
    description = "The completion request failed. Please try again or check your input"
    code = 400


class NoAudioUploadedError(BaseHTTPException):
    error_code = "no_audio_uploaded"
    description = "No audio file detected. Please upload an audio file and try again"
    code = 400


class AudioTooLargeError(BaseHTTPException):
    error_code = "audio_too_large"
    description = "The uploaded audio file exceeds the size limit. {message}"
    code = 413


class UnsupportedAudioTypeError(BaseHTTPException):
    error_code = "unsupported_audio_type"
    description = "The uploaded audio file type is not supported. Please use a compatible audio format"
    code = 415


class ProviderNotSupportSpeechToTextError(BaseHTTPException):
    error_code = "provider_not_support_speech_to_text"
    description = "The selected provider does not support speech-to-text functionality"
    code = 400


class NoFileUploadedError(BaseHTTPException):
    error_code = "no_file_uploaded"
    description = "No file detected. Please upload a file and try again"
    code = 400


class TooManyFilesError(BaseHTTPException):
    error_code = "too_many_files"
    description = "Multiple files detected. Please upload only one file"
    code = 400


class FileTooLargeError(BaseHTTPException):
    error_code = "file_too_large"
    description = "The uploaded file exceeds the size limit. {message}"
    code = 413


class UnsupportedFileTypeError(BaseHTTPException):
    error_code = "unsupported_file_type"
    description = "The uploaded file type is not supported. Please use a compatible file format"
    code = 415
