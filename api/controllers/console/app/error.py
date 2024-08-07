from libs.exception import BaseHTTPException


class AppNotFoundError(BaseHTTPException):
    error_code = 'app_not_found'
    description = "App not found."
    code = 404


class ProviderNotInitializeError(BaseHTTPException):
    error_code = 'provider_not_initialize'
    description = "No valid model provider credentials found. " \
                  "Please go to Settings -> Model Provider to complete your provider credentials."
    code = 400


class ProviderQuotaExceededError(BaseHTTPException):
    error_code = 'provider_quota_exceeded'
    description = "Your quota for Dify Hosted Model Provider has been exhausted. " \
                  "Please go to Settings -> Model Provider to complete your own provider credentials."
    code = 400


class ProviderModelCurrentlyNotSupportError(BaseHTTPException):
    error_code = 'model_currently_not_support'
    description = "Dify Hosted OpenAI trial currently not support the GPT-4 model."
    code = 400


class ConversationCompletedError(BaseHTTPException):
    error_code = 'conversation_completed'
    description = "The conversation has ended. Please start a new conversation."
    code = 400


class AppUnavailableError(BaseHTTPException):
    error_code = 'app_unavailable'
    description = "App unavailable, please check your app configurations."
    code = 400


class CompletionRequestError(BaseHTTPException):
    error_code = 'completion_request_error'
    description = "Completion request failed."
    code = 400


class AppMoreLikeThisDisabledError(BaseHTTPException):
    error_code = 'app_more_like_this_disabled'
    description = "The 'More like this' feature is disabled. Please refresh your page."
    code = 403


class NoAudioUploadedError(BaseHTTPException):
    error_code = 'no_audio_uploaded'
    description = "Please upload your audio."
    code = 400


class AudioTooLargeError(BaseHTTPException):
    error_code = 'audio_too_large'
    description = "Audio size exceeded. {message}"
    code = 413


class UnsupportedAudioTypeError(BaseHTTPException):
    error_code = 'unsupported_audio_type'
    description = "Audio type not allowed."
    code = 415


class ProviderNotSupportSpeechToTextError(BaseHTTPException):
    error_code = 'provider_not_support_speech_to_text'
    description = "Provider not support speech to text."
    code = 400


class NoFileUploadedError(BaseHTTPException):
    error_code = 'no_file_uploaded'
    description = "Please upload your file."
    code = 400


class TooManyFilesError(BaseHTTPException):
    error_code = 'too_many_files'
    description = "Only one file is allowed."
    code = 400


class DraftWorkflowNotExist(BaseHTTPException):
    error_code = 'draft_workflow_not_exist'
    description = "Draft workflow need to be initialized."
    code = 400


class DraftWorkflowNotSync(BaseHTTPException):
    error_code = 'draft_workflow_not_sync'
    description = "Workflow graph might have been modified, please refresh and resubmit."
    code = 400


class TracingConfigNotExist(BaseHTTPException):
    error_code = 'trace_config_not_exist'
    description = "Trace config not exist."
    code = 400


class TracingConfigIsExist(BaseHTTPException):
    error_code = 'trace_config_is_exist'
    description = "Trace config is exist."
    code = 400


class TracingConfigCheckError(BaseHTTPException):
    error_code = 'trace_config_check_error'
    description = "Invalid Credentials."
    code = 400
