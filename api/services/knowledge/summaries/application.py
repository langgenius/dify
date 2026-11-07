"""Summary vectorization policy independent of ORM, model providers, and vector stores."""

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from services.knowledge.resource_scope import SegmentRef

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SummaryVectorInput:
    ref: SegmentRef
    summary_id: str
    content: str
    previous_node_id: str | None


@dataclass(frozen=True)
class SummaryVectorResult:
    node_id: str
    content_hash: str
    tokens: int


class SummaryStore(Protocol):
    def completed(self, command: SummaryVectorInput, result: SummaryVectorResult) -> None: ...
    def failed(self, command: SummaryVectorInput, error: str) -> None: ...


class SummaryVectorBackend(Protocol):
    def delete(self, node_id: str) -> None: ...
    def count_tokens(self, content: str) -> int: ...
    def write(self, command: SummaryVectorInput, result: SummaryVectorResult) -> None: ...


class SummaryIndexService:
    def __init__(
        self,
        *,
        store: SummaryStore,
        vectors: SummaryVectorBackend,
        new_id: Callable[[], str],
        text_hash: Callable[[str], str],
        sleep: Callable[[float], None],
    ) -> None:
        self._store, self._vectors = store, vectors
        self._new_id, self._hash, self._sleep = new_id, text_hash, sleep

    def vectorize(self, command: SummaryVectorInput) -> SummaryVectorResult:
        if not command.content.strip():
            raise ValueError(f"Summary content is empty for segment {command.ref.segment_id}, cannot vectorize")
        node_id = command.previous_node_id or self._new_id()
        if command.previous_node_id:
            try:
                self._vectors.delete(command.previous_node_id)
            except Exception:
                logger.warning("Failed to delete previous summary vector for %s", command.ref.segment_id, exc_info=True)
        tokens = 0
        try:
            tokens = self._vectors.count_tokens(command.content)
        except Exception:
            logger.warning("Failed to calculate summary embedding tokens", exc_info=True)
        result = SummaryVectorResult(node_id, self._hash(command.content), tokens)
        for attempt in range(3):
            try:
                self._vectors.write(command, result)
                self._store.completed(command, result)
                return result
            except Exception as error:
                transient = any(
                    word in str(error).lower()
                    for word in ("connection", "disconnected", "timeout", "network", "weaviate")
                )
                if transient and attempt < 2:
                    self._sleep(2.0 * 2**attempt)
                    continue
                self._store.failed(command, f"Vectorization failed: {error}")
                raise
        raise AssertionError("Unreachable vectorization retry state")
