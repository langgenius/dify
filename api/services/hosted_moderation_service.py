"""Strict platform checks over independently classified text segments."""

import logging
from collections.abc import Iterable, Iterator, Mapping, Sequence
from typing import Protocol

from machinery.context import AppRequestContext
from services.moderation_service import (
    ModerationError,
    ModerationPhase,
    ModerationRejectedError,
    ModerationRule,
    moderation_phase_config,
)

logger = logging.getLogger(__name__)

_MAX_BATCH_ITEMS = 32
_MAX_BATCH_TEXT_BYTES = 8192


class HostedModerationBatchClient(Protocol):
    """Classify exact strings independently and return one boolean per item in request order."""

    def moderate(self, texts: Sequence[str]) -> tuple[bool, ...]: ...


class HostedModerationVerdictCache(Protocol):
    """Reuse exact-text verdicts only within one tenant and the configured classifier scope.

    Adapters expire entries, never persist raw text, and treat cache errors as
    misses. Concurrent misses may repeat classification; a cache hit never
    extends the life of a verdict.
    """

    def lookup(self, tenant_id: str, texts: Sequence[str]) -> Mapping[str, bool]: ...

    def store(self, tenant_id: str, verdicts: Mapping[str, bool]) -> None: ...


def _batches(texts: Iterable[str]) -> Iterator[list[str]]:
    """Bound item count and total UTF-8 text size without changing any segment.

    An individually oversized segment stays in its own batch to preserve the
    caller's moderation boundary.
    """
    batch: list[str] = []
    size = 0
    for text in texts:
        text_size = len(text.encode())
        if batch and (len(batch) == _MAX_BATCH_ITEMS or size + text_size > _MAX_BATCH_TEXT_BYTES):
            yield batch
            batch = []
            size = 0
        batch.append(text)
        size += text_size
    if batch:
        yield batch


class BatchedHostedModerationService:
    """Approve every nonempty segment using valid verdicts, never on missing results."""

    def __init__(
        self, *, client: HostedModerationBatchClient | None, cache: HostedModerationVerdictCache | None
    ) -> None:
        """Bind a platform client without I/O. No client means missing credentials; no cache disables reuse."""
        self._client = client
        self._cache = cache

    def check_segments(
        self,
        context: AppRequestContext,
        *,
        rule: ModerationRule,
        segments: Iterable[str],
        phase: ModerationPhase,
    ) -> None:
        """Approve an enabled OpenAI phase only after every distinct nonempty segment passes.

        A valid cached rejection is final. Confirmed batches can be cached even
        when they contain a rejection; malformed or failed batches cannot.
        """
        if not context.tenant_id or rule.type != "openai_moderation":
            raise ValueError("Batch moderation requires a tenant scope and an OpenAI rule.")
        phase_config = moderation_phase_config(rule, phase)
        if not phase_config["enabled"]:
            return
        if self._client is None:
            raise ModerationError("Hosted moderation credentials are not configured.")

        texts = tuple(dict.fromkeys(text for text in segments if text))
        if not texts:
            return
        cache = self._cache
        cached = cache.lookup(context.tenant_id, texts) if cache is not None else {}
        preset = phase_config.get("preset_response")
        message = preset if isinstance(preset, str) else ""
        if any(cached.get(text) is True for text in texts):
            self._reject(context, phase, message)

        for batch in _batches(text for text in texts if cached.get(text) is not False):
            verdicts = self._client.moderate(batch)
            if len(verdicts) != len(batch) or any(not isinstance(flagged, bool) for flagged in verdicts):
                raise ModerationError("Hosted moderation returned invalid batch verdicts.")
            if cache is not None:
                cache.store(context.tenant_id, dict(zip(batch, verdicts, strict=True)))
            if any(verdicts):
                self._reject(context, phase, message)

    @staticmethod
    def _reject(context: AppRequestContext, phase: ModerationPhase, message: str) -> None:
        """Log only scope and phase, and raise the same rejection for live and cached flags."""
        logger.warning(
            "Platform moderation rejected content. tenant_id=%s app_id=%s phase=%s source=openai_batch",
            context.tenant_id,
            context.app_id,
            phase,
        )
        raise ModerationRejectedError(phase, message)
