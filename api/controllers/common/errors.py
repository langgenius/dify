from werkzeug.exceptions import HTTPException

from libs.exception import BaseHTTPException


class FilenameNotExistsError(HTTPException):
    code = 400
    description = "The specified filename does not exist."


class RemoteFileUploadError(HTTPException):
    code = 400
    description = "Error uploading remote file."


class FileTooLargeError(BaseHTTPException):
    error_code = "file_too_large"
    description = "File size exceeded. {message}"
    code = 413


class UnsupportedFileTypeError(BaseHTTPException):
    error_code = "unsupported_file_type"
    description = "File type not allowed."
    code = 415


class BlockedFileExtensionError(BaseHTTPException):
    error_code = "file_extension_blocked"
    description = "The file extension is blocked for security reasons."
    code = 400


class TooManyFilesError(BaseHTTPException):
    error_code = "too_many_files"
    description = "Only one file is allowed."
    code = 400


class NoFileUploadedError(BaseHTTPException):
    error_code = "no_file_uploaded"
    description = "Please upload your file."
    code = 400


# App errors — canonical home for Studio ↔ Console shared exceptions

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


class DraftWorkflowNotExist(BaseHTTPException):
    error_code = "draft_workflow_not_exist"
    description = "Draft workflow need to be initialized."
    code = 404


class DraftWorkflowNotSync(BaseHTTPException):
    error_code = "draft_workflow_not_sync"
    description = "Workflow graph might have been modified, please refresh and resubmit."
    code = 409


class TracingConfigNotExist(BaseHTTPException):
    error_code = "trace_config_not_exist"
    description = "Trace config not exist."
    code = 400


class TracingConfigIsExist(BaseHTTPException):
    error_code = "trace_config_is_exist"
    description = "Trace config is exist."
    code = 400


class TracingConfigCheckError(BaseHTTPException):
    error_code = "trace_config_check_error"
    description = "Invalid Credentials."
    code = 400


class InvokeRateLimitError(BaseHTTPException):
    """Raised when the Invoke returns rate limit error."""

    error_code = "rate_limit_error"
    description = "Rate Limit Error"
    code = 429


class NeedAddIdsError(BaseHTTPException):
    error_code = "need_add_ids"
    description = "Need to add ids."
    code = 400


class NotCompletionAppError(BaseHTTPException):
    error_code = "not_completion_app"
    description = "Not Completion App"
    code = 400


class NotChatAppError(BaseHTTPException):
    error_code = "not_chat_app"
    description = "App mode is invalid."
    code = 400


class NotWorkflowAppError(BaseHTTPException):
    error_code = "not_workflow_app"
    description = "Only support workflow app."
    code = 400


class AppSuggestedQuestionsAfterAnswerDisabledError(BaseHTTPException):
    error_code = "app_suggested_questions_after_answer_disabled"
    description = "Function Suggested questions after answer disabled."
    code = 403


class AppAccessDeniedError(BaseHTTPException):
    error_code = "access_denied"
    description = "App access denied."
    code = 403


class TrialAppNotAllowed(BaseHTTPException):
    """*403* `Trial App Not Allowed`

    Raise if the user has reached the trial app limit.
    """

    error_code = "trial_app_not_allowed"
    code = 403
    description = "the app is not allowed to be trial."


class TrialAppLimitExceeded(BaseHTTPException):
    """*403* `Trial App Limit Exceeded`

    Raise if the user has exceeded the trial app limit.
    """

    error_code = "trial_app_limit_exceeded"
    code = 403
    description = "The user has exceeded the trial app limit."
