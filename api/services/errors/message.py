from core.message.exceptions import (
    FirstMessageNotFoundError,
    LastMessageNotFoundError,
    MessageNotFoundError,
)
from services.errors.base import BaseServiceError


class FirstMessageNotExistsError(BaseServiceError, FirstMessageNotFoundError):
    """Service-layer wrapper for missing first message errors."""


class LastMessageNotExistsError(BaseServiceError, LastMessageNotFoundError):
    """Service-layer wrapper for missing last message errors."""


class MessageNotExistsError(BaseServiceError, MessageNotFoundError):
    """Service-layer wrapper for generic message missing errors."""


class SuggestedQuestionsAfterAnswerDisabledError(BaseServiceError):
    pass
