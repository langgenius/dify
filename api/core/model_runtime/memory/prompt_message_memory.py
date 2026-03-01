from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from core.model_runtime.entities import PromptMessage


class PromptMessageMemory(Protocol):
    """Port for loading memory as prompt messages."""

    def get_history_prompt_messages(
        self, max_token_limit: int = 2000, message_limit: int | None = None
    ) -> Sequence[PromptMessage]:
        """Return historical prompt messages constrained by token/message limits."""
        ...
