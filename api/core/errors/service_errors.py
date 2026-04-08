"""Shared error classes for the core domain layer.

These error types were originally defined in ``services.errors`` but are
needed by ``core`` modules.  Keeping them in ``core.errors`` avoids a
circular dependency between the two packages.  The ``services.errors``
modules re-export these classes so that existing callers are unaffected.
"""


class BaseServiceError(ValueError):
    def __init__(self, description: str | None = None):
        self.description = description


# -- app_model_config errors --------------------------------------------------


class AppModelConfigBrokenError(BaseServiceError):
    pass


class ProviderNotFoundError(BaseServiceError):
    pass


# -- conversation errors -------------------------------------------------------


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


# -- message errors ------------------------------------------------------------


class FirstMessageNotExistsError(BaseServiceError):
    pass


class LastMessageNotExistsError(BaseServiceError):
    pass


class MessageNotExistsError(BaseServiceError):
    pass


class SuggestedQuestionsAfterAnswerDisabledError(BaseServiceError):
    pass


# -- app errors ----------------------------------------------------------------


class MoreLikeThisDisabledError(Exception):
    pass
