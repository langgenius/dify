from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from core.model_runtime.entities import PromptMessage

DEFAULT_MEMORY_MAX_TOKEN_LIMIT = 2000


class PromptMessageMemory(Protocol):
    """Port for loading memory as prompt messages."""

    def get_history_prompt_messages(
        self, max_token_limit: int = DEFAULT_MEMORY_MAX_TOKEN_LIMIT, message_limit: int | None = None
    ) -> Sequence[PromptMessage]:
        """Return historical prompt messages constrained by token/message limits."""
        ...
