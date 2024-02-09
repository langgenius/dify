from libs.exception import BaseHTTPException


class NotCompletionAppError(BaseHTTPException):
    error_code = 'not_completion_app'
    description = "Not Completion App"
    code = 400


class NotChatAppError(BaseHTTPException):
    error_code = 'not_chat_app'
    description = "Not Chat App"
    code = 400


class AppSuggestedQuestionsAfterAnswerDisabledError(BaseHTTPException):
    error_code = 'app_suggested_questions_after_answer_disabled'
    description = "Function Suggested questions after answer disabled."
    code = 403
