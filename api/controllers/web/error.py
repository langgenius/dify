# -*- coding:utf-8 -*-
from libs.exception import BaseHTTPException


class AppUnavailableError(BaseHTTPException):
    error_code = 'app_unavailable'
    description = "App unavailable."
    code = 400


class NotCompletionAppError(BaseHTTPException):
    error_code = 'not_completion_app'
    description = "Not Completion App"
    code = 400


class NotChatAppError(BaseHTTPException):
    error_code = 'not_chat_app'
    description = "Not Chat App"
    code = 400


class ConversationCompletedError(BaseHTTPException):
    error_code = 'conversation_completed'
    description = "Conversation Completed."
    code = 400


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


class CompletionRequestError(BaseHTTPException):
    error_code = 'completion_request_error'
    description = "Completion request failed."
    code = 400


class AppMoreLikeThisDisabledError(BaseHTTPException):
    error_code = 'app_more_like_this_disabled'
    description = "More like this disabled."
    code = 403


class AppSuggestedQuestionsAfterAnswerDisabledError(BaseHTTPException):
    error_code = 'app_suggested_questions_after_answer_disabled'
    description = "Function Suggested questions after answer disabled."
    code = 403
