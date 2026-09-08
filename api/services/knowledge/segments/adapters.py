"""Infrastructure adapters for dataset segment use cases."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, Protocol

from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.model_manager import ModelManager
from graphon.model_runtime.entities.model_entities import ModelType
from services.knowledge.segments.application import (
    SegmentDatasetRecord,
    SegmentModelProviderError,
)


class RedisSegmentClient(Protocol):
    def get(self, name: str | bytes) -> Any: ...

    def setnx(self, name: str | bytes, value: Any) -> Any: ...
    def setex(self, name: str, time: int, value: Any) -> Any: ...
    def lock(self, name: str, timeout: int) -> Any: ...


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
    def __init__(self, redis: RedisSegmentClient) -> None:
        self._redis = redis

    def lock(self, name: str, *, timeout: int):
        return self._redis.lock(name, timeout=timeout)

    def is_segment_indexing(self, segment_id: str, *, deleting: bool = False) -> bool:
        suffix = "delete_indexing" if deleting else "indexing"
        return self._redis.get(f"segment_{segment_id}_{suffix}") is not None

    def mark_segment_indexing(self, segment_id: str, *, deleting: bool = False) -> None:
        suffix = "delete_indexing" if deleting else "indexing"
        self._redis.setex(f"segment_{segment_id}_{suffix}", 600, 1)

    def is_document_indexing(self, document_id: str) -> bool:
        return self._redis.get(f"document_{document_id}_indexing") is not None

    def set_batch_waiting(self, job_id: str) -> None:
        self._redis.setnx(f"segment_batch_import_{job_id}", "waiting")

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
