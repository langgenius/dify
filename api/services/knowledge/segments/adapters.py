"""Infrastructure adapters for dataset segment use cases."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Any, Protocol

from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.model_manager import ModelManager
from graphon.model_runtime.entities.model_entities import ModelType
from repositories.knowledge.segment_read_adapter import format_segment_attachments, sign_segment_text
from services.knowledge.entities.segments import SegmentRecord
from services.knowledge.indexing.locks import KnowledgeIndexingLock
from services.knowledge.segments.application import SegmentModelProviderError
from services.knowledge.segments.contracts import SegmentDatasetRecord, SegmentReadSnapshot

_BATCH_WAITING_TTL_SECONDS = 86_400


class RedisSegmentClient(Protocol):
    def get(self, name: str | bytes) -> Any: ...

    def set(self, name: str | bytes, value: Any, *, nx: bool = False, ex: int | None = None) -> Any: ...
    def setex(self, name: str, time: int, value: Any) -> Any: ...
    def lock(self, name: str, timeout: int) -> Any: ...


class SegmentPresentationAdapter:
    """Turn detached owner-checked snapshots into signed response records."""

    def present(self, snapshots: Sequence[SegmentReadSnapshot]) -> tuple[SegmentRecord, ...]:
        return tuple(
            SegmentRecord.model_validate(
                {
                    **snapshot.values,
                    "sign_content": sign_segment_text(
                        str(snapshot.values["content"]),
                        allowed_uploads=snapshot.file_access.uploads,
                        allowed_tools=snapshot.file_access.tools,
                    ),
                    "child_chunks": snapshot.child_chunks,
                    "attachments": format_segment_attachments(snapshot.attachments),
                    "summary": snapshot.summary,
                }
            )
            for snapshot in snapshots
        )


class ModelManagerSegmentGuard:
    def check(self, dataset: SegmentDatasetRecord) -> None:
        try:
            ModelManager.for_tenant(tenant_id=dataset.workspace_id).get_model_instance(
                tenant_id=dataset.workspace_id,
                provider=dataset.embedding_model_provider or "",
                model_type=ModelType.TEXT_EMBEDDING,
                model=dataset.embedding_model or "",
            )
        except LLMBadRequestError as error:
            raise SegmentModelProviderError(kind="bad_request", description=str(error)) from error
        except ProviderTokenNotInitError as error:
            raise SegmentModelProviderError(kind="token", description=error.description) from error


class RedisSegmentIndexingState:
    def __init__(self, redis: RedisSegmentClient, *, locks: KnowledgeIndexingLock) -> None:
        self._redis = redis
        self._locks = locks

    def lock(self, name: str, *, timeout: int):
        return self._locks.hold(name, timeout=timeout, blocking_timeout=timeout)

    def is_segment_indexing(self, segment_id: str, *, deleting: bool = False) -> bool:
        suffix = "delete_indexing" if deleting else "indexing"
        return self._redis.get(f"segment_{segment_id}_{suffix}") is not None

    def mark_segment_indexing(self, segment_id: str, *, deleting: bool = False) -> None:
        suffix = "delete_indexing" if deleting else "indexing"
        self._redis.setex(f"segment_{segment_id}_{suffix}", 600, 1)

    def is_document_indexing(self, document_id: str) -> bool:
        return self._redis.get(f"document_{document_id}_indexing") is not None

    def set_batch_waiting(self, job_id: str) -> None:
        self._redis.set(
            f"segment_batch_import_{job_id}",
            "waiting",
            nx=True,
            ex=_BATCH_WAITING_TTL_SECONDS,
        )

    def get_batch_status(self, job_id: str) -> str | None:
        value = self._redis.get(f"segment_batch_import_{job_id}")
        if value is None:
            return None
        return value.decode() if isinstance(value, bytes) else value


class CelerySegmentBatchImportDispatcher:
    def __init__(self, *, delay: Callable[..., object]) -> None:
        self._delay = delay

    def dispatch(
        self,
        *,
        job_id: str,
        upload_file_id: str,
        dataset_id: str,
        document_id: str,
        workspace_id: str,
        actor_id: str,
    ) -> None:
        self._delay(job_id, upload_file_id, dataset_id, document_id, workspace_id, actor_id)
