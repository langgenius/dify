from services.errors.base import BaseServiceError


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
