"""Bounded publication of durable Human Input v2 delivery attempts."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from core.human_input_v2.approval import DeliveryAttemptRepository
from core.human_input_v2.shared import DeliveryAttemptId, UtcTimestamp


@dataclass(frozen=True, slots=True)
class DeliveryPublicationResult:
    due_count: int
    published_count: int


class HumanInputV2DueAttemptPublisher:
    def __init__(
        self,
        repository: DeliveryAttemptRepository,
        enqueue: Callable[[DeliveryAttemptId], None],
        *,
        clock: Callable[[], UtcTimestamp] = UtcTimestamp.now,
        batch_size: int = 100,
    ) -> None:
        if batch_size < 1:
            raise ValueError("delivery publication batch size must be positive")
        self._repository = repository
        self._enqueue = enqueue
        self._clock = clock
        self._batch_size = batch_size

    def publish_due(self) -> DeliveryPublicationResult:
        attempt_ids = self._repository.list_due_ids(now=self._clock(), limit=self._batch_size)
        published = 0
        for attempt_id in attempt_ids:
            try:
                self._enqueue(attempt_id)
            except Exception:
                continue
            published += 1
        return DeliveryPublicationResult(len(attempt_ids), published)


__all__ = ["DeliveryPublicationResult", "HumanInputV2DueAttemptPublisher"]
