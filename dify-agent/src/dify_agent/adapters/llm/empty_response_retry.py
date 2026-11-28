"""Resample non-streamed model requests that return no actionable output.

Thinking-capable models occasionally emit a completion made entirely of
reasoning content -- no text, no tool call. Pydantic AI rejects such a
response ("Please return text or call a tool") and, after one agent-level
retry, fails the whole run. A thinking-only completion is a sampling
artifact, so resampling the same request at the model boundary usually
recovers. Streaming requests pass through untouched: the response is only
observable once the stream is fully consumed, and agent-level retries still
apply to it.
"""

from __future__ import annotations

import logging
from typing import override

from pydantic_ai.messages import ModelMessage, ModelResponse, TextPart, ToolCallPart
from pydantic_ai.models import KnownModelName, Model, ModelRequestParameters
from pydantic_ai.models.wrapper import WrapperModel
from pydantic_ai.settings import ModelSettings

logger = logging.getLogger(__name__)

DEFAULT_MAX_ATTEMPTS = 3


def has_actionable_parts(response: ModelResponse) -> bool:
    """True when the response carries text or a tool call the agent can use."""
    for part in response.parts:
        if isinstance(part, ToolCallPart):
            return True
        if isinstance(part, TextPart) and part.content.strip():
            return True
    return False


class EmptyResponseRetryModel(WrapperModel):
    """Wrap a model so empty (thinking-only) non-streamed responses are resampled."""

    def __init__(self, wrapped: Model | KnownModelName, *, max_attempts: int = DEFAULT_MAX_ATTEMPTS) -> None:
        super().__init__(wrapped)
        self.max_attempts = max(1, max_attempts)

    @override
    async def request(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
    ) -> ModelResponse:
        response = await self.wrapped.request(messages, model_settings, model_request_parameters)
        attempt = 1
        while not has_actionable_parts(response) and attempt < self.max_attempts:
            logger.info(
                "Model %s returned no actionable output (thinking-only); resampling (attempt %d/%d)",
                self.wrapped.model_name,
                attempt + 1,
                self.max_attempts,
            )
            attempt += 1
            response = await self.wrapped.request(messages, model_settings, model_request_parameters)
        return response
