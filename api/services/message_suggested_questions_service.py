"""Shared suggested-question capability for an admitted app and message actor.

Callers own access admission, supported app modes, quotas and HTTP errors.
The app owner tenant is independent of an account's active workspace.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal, Protocol

from services.errors.message import SuggestedQuestionsAfterAnswerDisabledError


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


@dataclass(frozen=True, slots=True)
class SuggestedQuestionsContext:
    """An authorized message and its selected configuration, without ORM state."""

    app_id: str
    tenant_id: str
    app_mode: str
    message_id: str
    conversation_id: str
    actor: SuggestedQuestionsActor
    config: Mapping[str, object]


class SuggestedQuestionsContextQuery(Protocol):
    def prepare(
        self,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        expected_app_mode: str,
        actor: SuggestedQuestionsActor,
        message_id: str,
    ) -> SuggestedQuestionsContext | None:
        """Return message configuration, or None when there is no selected workflow."""
        ...


class SuggestedQuestionsGeneration(Protocol):
    def generate(
        self,
        *,
        context: SuggestedQuestionsContext,
        instruction_prompt: str | None,
        model_config: object | None,
    ) -> list[str]:
        """Generate questions; None selects the built-in prompt or default model."""
        ...


class MessageSuggestedQuestionsService:
    """Apply the feature policy shared by every message suggested-question endpoint."""

    def __init__(self, *, queries: SuggestedQuestionsContextQuery, generator: SuggestedQuestionsGeneration) -> None:
        self._queries: SuggestedQuestionsContextQuery = queries
        self._generator: SuggestedQuestionsGeneration = generator

    def get_suggested_questions(
        self,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        expected_app_mode: str,
        actor: SuggestedQuestionsActor,
        message_id: str,
    ) -> list[str]:
        context = self._queries.prepare(
            app_id=app_id,
            app_owner_tenant_id=app_owner_tenant_id,
            expected_app_mode=expected_app_mode,
            actor=actor,
            message_id=message_id,
        )
        if context is None:
            return []

        enabled = context.config.get("enabled", False)
        # Agent and workflow features use truthiness; legacy model configs have
        # historically disabled this feature only for an explicit False value.
        disabled = not enabled if context.app_mode in {"agent", "advanced-chat"} else enabled is False
        if disabled:
            raise SuggestedQuestionsAfterAnswerDisabledError()

        prompt = context.config.get("prompt")
        instruction_prompt = prompt if isinstance(prompt, str) and prompt.strip() else None
        return self._generator.generate(
            context=context,
            instruction_prompt=instruction_prompt,
            model_config=context.config.get("model"),
        )
