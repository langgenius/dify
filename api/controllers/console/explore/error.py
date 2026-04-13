from libs.exception import BaseHTTPException


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
