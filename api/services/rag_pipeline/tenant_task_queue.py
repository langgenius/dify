from __future__ import annotations

import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from enum import StrEnum

from celery import signature

from extensions.ext_redis import redis_client
from libs.acknowledged_task_queue import (
    AcknowledgedTaskClaim,
    AcknowledgedTaskClaimAlreadyActiveError,
    AcknowledgedTaskClaimLostError,
    AcknowledgedTaskCompletion,
    AcknowledgedTaskExecutionBudgetExhaustedError,
    AcknowledgedTaskQueue,
    RedisScripts,
    dispatch_acknowledged_claims,
)
from services.rag_pipeline.entities import RagPipelineDocumentRecovery

_CLAIM_LEASE_SECONDS = 60 * 60
_CLAIM_HEARTBEAT_SECONDS = 60
_MAX_EXECUTION_ATTEMPTS = 5

RAG_PIPELINE_V2_QUEUE = "pipeline_v2"
RAG_PIPELINE_PRIORITY_V2_QUEUE = "priority_pipeline_v2"


class RagPipelineTaskProtocol(StrEnum):
    """Broker protocol selected by the serialized input file shape."""

    LEGACY_LIST = "legacy_list"
    SNAPSHOT_BATCH_V2 = "snapshot_batch_v2"


class RagPipelineTaskTarget(StrEnum):
    REGULAR = "regular"
    PRIORITY = "priority"

    @property
    def task_name(self) -> str:
        if self is RagPipelineTaskTarget.REGULAR:
            return "tasks.rag_pipeline.rag_pipeline_run_task.rag_pipeline_run_task"
        return "tasks.rag_pipeline.priority_rag_pipeline_run_task.priority_rag_pipeline_run_task"

    @property
    def queue_name(self) -> str:
        if self is RagPipelineTaskTarget.REGULAR:
            return "pipeline"
        return "priority_pipeline"


@dataclass(frozen=True, slots=True)
class RagPipelineTenantTask:
    file_id: str
    target: RagPipelineTaskTarget
    protocol: RagPipelineTaskProtocol = RagPipelineTaskProtocol.LEGACY_LIST
    document_recoveries: tuple[RagPipelineDocumentRecovery, ...] = ()

    @property
    def task_name(self) -> str:
        if self.protocol is RagPipelineTaskProtocol.LEGACY_LIST:
            return self.target.task_name
        if self.target is RagPipelineTaskTarget.REGULAR:
            return "tasks.rag_pipeline.rag_pipeline_run_task.rag_pipeline_run_task_v2"
        return "tasks.rag_pipeline.priority_rag_pipeline_run_task.priority_rag_pipeline_run_task_v2"

    @property
    def queue_name(self) -> str:
        if self.protocol is RagPipelineTaskProtocol.LEGACY_LIST:
            return self.target.queue_name
        if self.target is RagPipelineTaskTarget.REGULAR:
            return RAG_PIPELINE_V2_QUEUE
        return RAG_PIPELINE_PRIORITY_V2_QUEUE

    def serialize(self) -> str:
        return json.dumps(
            {
                "file_id": self.file_id,
                "target": self.target.value,
                "protocol": self.protocol.value,
                "document_recoveries": [item.model_dump(mode="json") for item in self.document_recoveries],
            },
            separators=(",", ":"),
        )

    @classmethod
    def deserialize(cls, value: str) -> RagPipelineTenantTask:
        payload = json.loads(value)
        return cls(
            file_id=payload["file_id"],
            target=RagPipelineTaskTarget(payload["target"]),
            protocol=RagPipelineTaskProtocol(payload.get("protocol", RagPipelineTaskProtocol.LEGACY_LIST)),
            document_recoveries=tuple(
                RagPipelineDocumentRecovery.model_validate(item) for item in payload.get("document_recoveries", ())
            ),
        )


RagPipelineTaskClaim = AcknowledgedTaskClaim[RagPipelineTenantTask]
RagPipelineTaskCompletion = AcknowledgedTaskCompletion[RagPipelineTenantTask]
RagPipelineTaskClaimLostError = AcknowledgedTaskClaimLostError
RagPipelineTaskClaimAlreadyActiveError = AcknowledgedTaskClaimAlreadyActiveError
RagPipelineTaskExecutionBudgetExhaustedError = AcknowledgedTaskExecutionBudgetExhaustedError


class RagPipelinePermanentTaskError(RuntimeError):
    """The serialized pipeline batch cannot succeed after another delivery."""


class RagPipelineTenantTaskQueue(AcknowledgedTaskQueue[RagPipelineTenantTask]):
    def __init__(
        self,
        tenant_id: str,
        *,
        redis: RedisScripts = redis_client,
        token_factory: Callable[[], str] | None = None,
        lease_seconds: int = _CLAIM_LEASE_SECONDS,
        heartbeat_seconds: int = _CLAIM_HEARTBEAT_SECONDS,
        max_execution_attempts: int = _MAX_EXECUTION_ATTEMPTS,
    ) -> None:
        self._tenant_id = tenant_id
        super().__init__(
            tenant_id,
            namespace="rag_pipeline",
            serialize=RagPipelineTenantTask.serialize,
            deserialize=RagPipelineTenantTask.deserialize,
            identity=lambda task: task.file_id,
            redis=redis,
            token_factory=token_factory,
            lease_seconds=lease_seconds,
            heartbeat_seconds=heartbeat_seconds,
            max_execution_attempts=max_execution_attempts,
        )

    @classmethod
    def registered_tenants(
        cls,
        *,
        redis: RedisScripts = redis_client,
        batch_size: int = 500,
    ) -> tuple[str, ...]:
        return cls.registered_scopes(
            namespace="rag_pipeline",
            redis=redis,
            batch_size=batch_size,
        )


def dispatch_rag_pipeline_claims(
    *,
    tenant_id: str,
    queue: RagPipelineTenantTaskQueue,
    claims: Sequence[RagPipelineTaskClaim],
) -> int:
    def publish(claim: RagPipelineTaskClaim) -> None:
        signature(claim.task.task_name, queue=claim.task.queue_name).delay(
            rag_pipeline_invoke_entities_file_id=claim.task.file_id,
            tenant_id=tenant_id,
            tenant_queue_receipt=claim.receipt,
        )

    return dispatch_acknowledged_claims(
        queue=queue,
        claims=claims,
        publish=publish,
        description=f"RAG pipeline tasks for tenant {tenant_id}",
    )
