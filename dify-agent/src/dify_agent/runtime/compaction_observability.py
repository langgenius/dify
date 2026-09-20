"""Observability boundary for the Dify Agent compaction capability."""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from pydantic_ai.capabilities import AbstractCapability
from pydantic_ai_harness.compaction import TieredCompaction, estimate_context_tokens

if TYPE_CHECKING:
    from logging import Logger

    from pydantic_ai.messages import ModelMessage
    from pydantic_ai.models import ModelRequestContext
    from pydantic_ai.tools import RunContext


def _default_logger() -> Logger:
    return logging.getLogger(__name__)


@dataclass
class ObservableCompactionAdapter(AbstractCapability[None]):
    """Delegate compaction and log only when a request history is rewritten."""

    delegate: TieredCompaction[None]
    run_id: str = field(kw_only=True)
    logger: Logger = field(kw_only=True, default_factory=_default_logger)

    async def before_model_request(
        self,
        ctx: RunContext[None],
        request_context: ModelRequestContext,
    ) -> ModelRequestContext:
        """Run the real capability, then emit a structured boundary observation."""
        before_messages: Sequence[ModelMessage] = list(request_context.messages)
        result_context = await self.delegate.before_model_request(ctx, request_context)
        after_messages = result_context.messages
        compacted = len(after_messages) != len(before_messages) or any(
            before is not after for before, after in zip(before_messages, after_messages, strict=False)
        )
        if not compacted:
            return result_context

        model_request_parameters = request_context.model_request_parameters
        self.logger.info(
            "agent context compacted",
            extra={
                "run_id": self.run_id,
                "target_tokens": self.delegate.target_tokens,
                "tier": "unknown",
                "before_message_count": len(before_messages),
                "after_message_count": len(after_messages),
                "before_estimated_tokens": estimate_context_tokens(
                    before_messages,
                    self.delegate.tokenizer,
                    model_request_parameters=model_request_parameters,
                ),
                "after_estimated_tokens": estimate_context_tokens(
                    after_messages,
                    self.delegate.tokenizer,
                    model_request_parameters=model_request_parameters,
                ),
            },
        )
        return result_context


def wrap_compaction_observability(
    compaction: TieredCompaction[None] | None,
    *,
    run_id: str,
    logger: Logger | None = None,
) -> ObservableCompactionAdapter | None:
    """Wrap a non-null compaction capability without changing its builder contract."""
    if compaction is None:
        return None
    return ObservableCompactionAdapter(
        compaction,
        run_id=run_id,
        logger=logger if logger is not None else _default_logger(),
    )


__all__ = ["ObservableCompactionAdapter", "wrap_compaction_observability"]
