"""Process one durable IM callback outside repository transactions."""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import datetime

from core.human_input_v2.im_message_inbox import IMInboxConsumer, IMInboxRecordId, IMMessageInboxRepository

logger = logging.getLogger(__name__)


class IMInboxProcessor:
    """Load one callback, invoke its consumer, and record successful processing."""

    def __init__(
        self,
        *,
        repository: IMMessageInboxRepository,
        consumer: IMInboxConsumer,
        clock: Callable[[], datetime],
    ) -> None:
        self._repository = repository
        self._consumer = consumer
        self._clock = clock

    def process(self, record_id: IMInboxRecordId) -> None:
        record = self._repository.get(record_id)
        if record is None:
            logger.warning("IM callback record does not exist record_id=%s", record_id)
            return
        if record.processed_at is not None:
            return

        self._consumer.consume(record)
        self._repository.mark_processed(record_id, processed_at=self._clock())
