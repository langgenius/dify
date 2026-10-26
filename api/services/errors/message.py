from services.errors.base import BaseServiceError


class MessageActorNotFoundError(LookupError):
    """The account is missing, or the end user is outside the admitted app and tenant scope."""


class FirstMessageNotExistsError(BaseServiceError):
    pass


class LastMessageNotExistsError(BaseServiceError):
    pass


class MessageNotExistsError(BaseServiceError):
    pass


class SuggestedQuestionsAfterAnswerDisabledError(BaseServiceError):
    pass
