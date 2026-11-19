"""Summary vectorization policy independent of ORM, model providers, and vector stores."""

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from services.knowledge.entities.resource_scope import SegmentRef

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SummaryVectorInput:
    ref: SegmentRef
    summary_id: str
    content: str
    previous_node_id: str | None
    expected_updated_at: datetime
    expected_status: str
    expected_enabled: bool


@dataclass(frozen=True)
class SummaryVectorResult:
    node_id: str
    content_hash: str
    tokens: int


class SummaryStore(Protocol):
    def completed(self, command: SummaryVectorInput, result: SummaryVectorResult) -> bool: ...
    def failed(self, command: SummaryVectorInput, error: str) -> bool: ...
    def is_published(self, command: SummaryVectorInput, result: SummaryVectorResult) -> bool: ...


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

    def vectorize(self, command: SummaryVectorInput) -> SummaryVectorResult | None:
        if not command.content.strip():
            raise ValueError(f"Summary content is empty for segment {command.ref.segment_id}, cannot vectorize")
        # Every attempt publishes a new physical node. Reusing the currently
        # published node would let a superseded writer overwrite a newer
        # summary before the database CAS can reject it.
        node_id = self._new_id()
        tokens = 0
        try:
            tokens = self._vectors.count_tokens(command.content)
        except Exception:
            logger.warning("Failed to calculate summary embedding tokens", exc_info=True)
        result = SummaryVectorResult(node_id, self._hash(command.content), tokens)
        for attempt in range(3):
            try:
                self._vectors.write(command, result)
                if not self._store.completed(command, result):
                    self._delete_vector(node_id, command, reason="unpublished")
                    return None
                if command.previous_node_id and command.previous_node_id != node_id:
                    self._delete_vector(command.previous_node_id, command, reason="replaced")
                return result
            except Exception as error:
                try:
                    published = self._store.is_published(command, result)
                except Exception as confirmation_error:
                    # A failed read cannot prove the new node is disposable. It
                    # may already be the row's published node after a lost
                    # commit acknowledgement, so preserve it for a later retry.
                    logger.exception(
                        "Could not confirm summary publication for %s",
                        command.ref.segment_id,
                    )
                    raise error from confirmation_error
                if published:
                    if command.previous_node_id and command.previous_node_id != node_id:
                        self._delete_vector(command.previous_node_id, command, reason="replaced")
                    return result
                transient = any(
                    word in str(error).lower()
                    for word in ("connection", "disconnected", "timeout", "network", "weaviate")
                )
                if transient and attempt < 2:
                    self._sleep(2.0 * 2**attempt)
                    continue
                if not self._store.failed(command, f"Vectorization failed: {error}"):
                    self._delete_vector(node_id, command, reason="unpublished")
                    return None
                self._delete_vector(node_id, command, reason="failed")
                raise
        raise AssertionError("Unreachable vectorization retry state")

    def _delete_vector(self, node_id: str, command: SummaryVectorInput, *, reason: str) -> None:
        try:
            self._vectors.delete(node_id)
        except Exception:
            logger.warning(
                "Failed to delete %s summary vector for %s",
                reason,
                command.ref.segment_id,
                exc_info=True,
            )
