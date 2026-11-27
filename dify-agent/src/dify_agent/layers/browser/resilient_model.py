"""A browser-use chat model with a larger sub-agent output retry budget.

`PydanticAIChatModel` builds its inner Pydantic AI agent with the default
retry budget (one output retry). A thinking-only completion that survives
`EmptyResponseRetryModel`'s resampling therefore surfaces as a failed
browser step, consuming one of browser-use's few per-step failure retries.
Rebuilding the inner agent with an explicit output retry budget absorbs a
burst of such completions before it can do that.
"""

from __future__ import annotations

from pydantic_ai import Agent
from pydantic_ai.models import KnownModelName, Model

from pydantic_ai_harness.browser_use import PydanticAIChatModel

DEFAULT_OUTPUT_RETRIES = 3


class ResilientPydanticAIChatModel(PydanticAIChatModel):
    """A `PydanticAIChatModel` whose inner agent retries empty output turns."""

    def __init__(self, model: Model | KnownModelName | str, *, output_retries: int = DEFAULT_OUTPUT_RETRIES) -> None:
        super().__init__(model)
        # The parent built its agent with the default budget. Rebuild it so
        # a burst of thinking-only completions is retried here, before it
        # can consume browser-use's per-step failure budget.
        self._agent = Agent(self._model, retries={"output": max(0, output_retries)})
