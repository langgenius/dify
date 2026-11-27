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


class HostedModerationUnavailableError(ModerationError):
    """No trustworthy verdict is available from the platform backend; the message is safe to log."""


class HostedModerationBatchClient(Protocol):
    """Return one verdict per exact string or raise HostedModerationUnavailableError for backend failures."""

    def moderate(self, texts: Sequence[str]) -> tuple[bool, ...]: ...


class HostedModerationVerdictCache(Protocol):
    """Reuse exact-text verdicts only within one tenant and the configured classifier scope.

    Adapters expire entries, never persist raw text, and treat cache errors as
    misses. Concurrent misses may repeat classification; a cache hit never
    extends the life of a verdict.
    """

    def lookup(self, tenant_id: str, texts: Sequence[str]) -> Mapping[str, bool]: ...

    def store(self, tenant_id: str, verdicts: Mapping[str, bool]) -> None: ...


def _batches(texts: Iterable[str], *, max_items: int, max_text_bytes: int) -> Iterator[list[str]]:
    """Pack segments with positive item and UTF-8 byte budgets without changing them.

    An individually oversized segment stays in its own batch to preserve the
    caller's moderation boundary.
    """
    batch: list[str] = []
    size = 0
    for text in texts:
        text_size = len(text.encode())
        if batch and (len(batch) == max_items or size + text_size > max_text_bytes):
            yield batch
            batch = []
            size = 0
        batch.append(text)
        size += text_size
    if batch:
        yield batch


class BatchedHostedModerationService:
    """Treat known rejections as final and keep unavailable verdicts distinct from approvals."""

    def __init__(
        self,
        *,
        client: HostedModerationBatchClient | None,
        cache: HostedModerationVerdictCache | None,
        batch_max_items: int,
        batch_max_text_bytes: int,
    ) -> None:
        """Bind the client and positive batch limits without I/O; None means no credentials or cache, respectively."""
        if batch_max_items <= 0 or batch_max_text_bytes <= 0:
            raise ValueError("Moderation batch limits must be positive.")
        self._client = client
        self._cache = cache
        self._batch_max_items = batch_max_items
        self._batch_max_text_bytes = batch_max_text_bytes

    def check_segments(
        self,
        context: AppRequestContext,
        *,
        rule: ModerationRule,
        segments: Iterable[str],
        phase: ModerationPhase,
        cache_only: bool = False,
    ) -> None:
        """Classify each distinct segment, or enforce only existing verdicts in cache-only mode.

        Cached and live rejections are final. An unavailable live check raises
        without writing verdicts for its batch. Cache-only mode makes no remote
        requests and leaves misses unclassified.
        """
        if not context.tenant_id or rule.type != "openai_moderation":
            raise ValueError("Batch moderation requires a tenant scope and an OpenAI rule.")
        phase_config = moderation_phase_config(rule, phase)
        if not phase_config["enabled"]:
            return

        texts = tuple(dict.fromkeys(text for text in segments if text))
        if not texts:
            return
        cache = self._cache
        cached = cache.lookup(context.tenant_id, texts) if cache is not None else {}
        preset = phase_config.get("preset_response")
        message = preset if isinstance(preset, str) else ""
        if any(cached.get(text) is True for text in texts):
            self._reject(context, phase, message)
        if cache_only:
            return
        if self._client is None:
            raise HostedModerationUnavailableError("Hosted moderation credentials are not configured.")

        misses = (text for text in texts if cached.get(text) is not False)
        for batch in _batches(misses, max_items=self._batch_max_items, max_text_bytes=self._batch_max_text_bytes):
            verdicts = self._client.moderate(batch)
            if len(verdicts) != len(batch) or any(not isinstance(flagged, bool) for flagged in verdicts):
                raise HostedModerationUnavailableError("Hosted moderation returned invalid batch verdicts.")
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
