class BaseServiceError(ValueError):
    def __init__(self, description: str | None = None):
        self.description = description


class AppModelConfigBrokenError(BaseServiceError):
    pass


class ProviderNotFoundError(BaseServiceError):
    pass


class LastConversationNotExistsError(BaseServiceError):
    pass


class ConversationNotExistsError(BaseServiceError):
    pass


class ConversationCompletedError(Exception):
    pass


class ConversationVariableNotExistsError(BaseServiceError):
    pass


class ConversationVariableTypeMismatchError(BaseServiceError):
    pass


class FirstMessageNotExistsError(BaseServiceError):
    pass


class LastMessageNotExistsError(BaseServiceError):
    pass


class MessageNotExistsError(BaseServiceError):
    pass


class SuggestedQuestionsAfterAnswerDisabledError(BaseServiceError):
    pass


class MoreLikeThisDisabledError(Exception):
    pass
