"""Summary vectorization policy independent of ORM, model providers, and vector stores."""

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from services.knowledge.resource_scope import SegmentRef

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SummaryWriteFence:
    """Database state that must still own a summary write."""

    expected_document_generation: str | None = None
    enforce_document_generation: bool = False
    expected_segment_generation: str | None = None
    enforce_segment_generation: bool = False
    expected_segment_status: str = "completed"
    task_intent_id: str | None = None
    task_execution_id: str | None = None
    expected_indexing_technique: str | None = None
    expected_embedding_model_provider: str | None = None
    expected_embedding_model: str | None = None
    expected_summary_index_setting: dict[str, object] | None = None
    enforce_summary_index_setting: bool = False


class SummaryWriteFenceLostError(RuntimeError):
    """The document, segment, dataset configuration, or task claim changed."""


class SummaryCompletionAckError(RuntimeError):
    """The vector exists, but persisting its completion receipt failed."""


@dataclass(frozen=True)
class SummaryVectorInput:
    ref: SegmentRef
    summary_id: str
    content: str
    previous_node_id: str | None
    fence: SummaryWriteFence | None = None


@dataclass(frozen=True)
class SummaryVectorResult:
    node_id: str
    content_hash: str
    tokens: int


class SummaryStore(Protocol):
    def assert_current(self, command: SummaryVectorInput) -> None: ...
    def generated(self, command: SummaryVectorInput) -> None: ...
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
        node_id = self._new_id()
        tokens = 0
        try:
            tokens = self._vectors.count_tokens(command.content)
        except Exception:
            logger.warning("Failed to calculate summary embedding tokens", exc_info=True)
        result = SummaryVectorResult(node_id, self._hash(command.content), tokens)
        try:
            self._retry_transient(lambda: self._vectors.write(command, result))
        except Exception as error:
            self._store.failed(command, f"Vectorization failed: {error}")
            raise
        try:
            self._retry_transient(lambda: self._store.completed(command, result))
        except SummaryWriteFenceLostError:
            try:
                self._vectors.delete(result.node_id)
            except Exception:
                logger.warning("Failed to delete rejected summary vector for %s", command.ref.segment_id, exc_info=True)
            raise
        except Exception as error:
            raise SummaryCompletionAckError(f"Failed to persist completed summary vector: {error}") from error
        if command.previous_node_id and command.previous_node_id != result.node_id:
            try:
                self._vectors.delete(command.previous_node_id)
            except Exception:
                logger.warning("Failed to delete previous summary vector for %s", command.ref.segment_id, exc_info=True)
        return result

    def _retry_transient(self, operation: Callable[[], None]) -> None:
        """Retry one stage without replaying an already successful prior stage."""
        for attempt in range(3):
            try:
                operation()
                return
            except Exception as error:
                transient = any(
                    word in str(error).lower()
                    for word in ("connection", "disconnected", "timeout", "network", "weaviate")
                )
                if transient and attempt < 2:
                    self._sleep(2.0 * 2**attempt)
                    continue
                raise
        raise AssertionError("Unreachable summary stage retry state")
