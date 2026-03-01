from __future__ import annotations

from collections.abc import Sequence
from typing import Any, Protocol

from core.model_manager import ModelInstance
from core.model_runtime.entities import PromptMessage


class CredentialsProvider(Protocol):
    """Port for loading runtime credentials for a provider/model pair."""

    def fetch(self, provider_name: str, model_name: str) -> dict[str, Any]:
        """Return credentials for the target provider/model or raise a domain error."""
        ...


class ModelFactory(Protocol):
    """Port for creating initialized LLM model instances for execution."""

    def init_model_instance(self, provider_name: str, model_name: str) -> ModelInstance:
        """Create a model instance that is ready for schema lookup and invocation."""
        ...


class PromptMessageMemory(Protocol):
    """Port for loading memory as prompt messages for LLM nodes."""

    def get_history_prompt_messages(
        self, max_token_limit: int = 2000, message_limit: int | None = None
    ) -> Sequence[PromptMessage]:
        """Return historical prompt messages constrained by token/message limits."""
        ...
