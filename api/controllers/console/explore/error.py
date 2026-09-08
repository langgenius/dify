from core.logging.context import get_request_id
from libs.exception import BaseHTTPException


class InstalledAppHTTPError(BaseHTTPException):
    """A Console error with safe details and a request ID for troubleshooting."""

    def __init__(self) -> None:
        super().__init__()
        details: dict[str, object] = {"request_id": get_request_id()}
        self.data = {"code": self.error_code, "message": self.description, "status": self.code, "details": details}


class InstalledAppNotFoundHTTPError(InstalledAppHTTPError):
    error_code = "installed_app_not_found"
    description = "The app was not found in this workspace."
    code = 404


class InstalledAppUnavailableHTTPError(InstalledAppHTTPError):
    error_code = "installed_app_unavailable"
    description = "The app is not available in this app library."
    code = 404


class InstalledAppUninstallForbiddenError(InstalledAppHTTPError):
    error_code = "installed_app_uninstall_forbidden"
    description = "An app owned by this workspace cannot be removed from its app library."
    code = 403


class InstalledAppInvalidCursorError(InstalledAppHTTPError):
    error_code = "invalid_cursor"
    description = "The app list cursor is invalid. Refresh the list and try again."
    code = 400


class WebAppAccessUnavailableHTTPError(InstalledAppHTTPError):
    error_code = "web_app_access_unavailable"
    description = "The app access service is unavailable. Try again later."
    code = 503


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


class RecommendedAppNotFoundError(BaseHTTPException):
    error_code = "recommended_app_not_found"
    description = "Recommended app not found."
    code = 404


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


class TrialAppFeatureDisabledError(BaseHTTPException):
    error_code = "trial_app_feature_disabled"
    code = 403
    description = "Trial app feature is not enabled."
