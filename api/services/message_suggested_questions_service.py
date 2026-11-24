"""Shared suggested-question capability for an admitted app and message actor.

Callers own access admission, supported app modes, quotas and HTTP errors.
The app owner tenant is independent of an account's active workspace.
"""

from collections.abc import Callable, Mapping
from contextlib import AbstractContextManager
from dataclasses import dataclass
from typing import Literal, Protocol

from services.entities.message_entities import MessageActor
from services.errors.message import SuggestedQuestionsAfterAnswerDisabledError

type SuggestedQuestionsInvokeFrom = Literal["explore", "debugger", "web-app", "service-api"]


class MessageSuggestedQuestions(Protocol):
    def get_suggested_questions(
        self,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        expected_app_mode: str,
        actor: MessageActor,
        invoke_from: SuggestedQuestionsInvokeFrom,
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
    actor: MessageActor
    invoke_from: SuggestedQuestionsInvokeFrom
    config: Mapping[str, object]


class SuggestedQuestionsContextQuery[HistoryT](Protocol):
    def prepare(
        self,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        expected_app_mode: str,
        actor: MessageActor,
        invoke_from: SuggestedQuestionsInvokeFrom,
        message_id: str,
    ) -> SuggestedQuestionsContext | None:
        """Return message configuration, or None when there is no selected workflow."""
        ...

    def load_history(self, *, context: SuggestedQuestionsContext) -> HistoryT:
        """Return detached history after closing its query session."""
        ...


class SuggestedQuestionsGeneration[HistoryT](Protocol):
    def prepare(
        self,
        *,
        context: SuggestedQuestionsContext,
        instruction_prompt: str | None,
        model_config: object | None,
    ) -> AbstractContextManager[Callable[[HistoryT], list[str]] | None]:
        """Isolate one generation attempt and resolve its history model.

        Yield None when no history model is available; otherwise yield a
        generator accepting detached history. None prompt/model inputs select
        the built-in prompt and default model.
        """
        ...


class MessageSuggestedQuestionsService[HistoryT]:
    """Apply the feature policy shared by every message suggested-question endpoint."""

    def __init__(
        self,
        *,
        queries: SuggestedQuestionsContextQuery[HistoryT],
        generator: SuggestedQuestionsGeneration[HistoryT],
    ) -> None:
        self._queries: SuggestedQuestionsContextQuery[HistoryT] = queries
        self._generator: SuggestedQuestionsGeneration[HistoryT] = generator

    def get_suggested_questions(
        self,
        *,
        app_id: str,
        app_owner_tenant_id: str,
        expected_app_mode: str,
        actor: MessageActor,
        invoke_from: SuggestedQuestionsInvokeFrom,
        message_id: str,
    ) -> list[str]:
        context = self._queries.prepare(
            app_id=app_id,
            app_owner_tenant_id=app_owner_tenant_id,
            expected_app_mode=expected_app_mode,
            actor=actor,
            invoke_from=invoke_from,
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
        with self._generator.prepare(
            context=context,
            instruction_prompt=instruction_prompt,
            model_config=context.config.get("model"),
        ) as generate:
            if generate is None:
                return []
            history = self._queries.load_history(context=context)
            return generate(history)
