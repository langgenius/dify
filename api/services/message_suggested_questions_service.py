"""Shared suggested-question capability for an admitted app and message actor.

Callers own access admission, supported app modes, quotas and HTTP errors.
The app owner tenant is independent of an account's active workspace.
"""

from dataclasses import dataclass
from typing import Literal, Protocol


@dataclass(frozen=True, slots=True)
class SuggestedQuestionsAccount:
    account_id: str
    invoke_from: Literal["explore", "debugger"]


@dataclass(frozen=True, slots=True)
class SuggestedQuestionsEndUser:
    end_user_id: str
    invoke_from: Literal["web-app", "service-api"]


type SuggestedQuestionsActor = SuggestedQuestionsAccount | SuggestedQuestionsEndUser


class SuggestedQuestionsActorNotFoundError(LookupError):
    """The account is missing, or the end user is outside the admitted app scope."""


class MessageSuggestedQuestions(Protocol):
    def get_suggested_questions(
        self,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        expected_app_mode: str,
        actor: SuggestedQuestionsActor,
        message_id: str,
    ) -> list[str]: ...
