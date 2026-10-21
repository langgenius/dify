"""Tenant admission for durable knowledge indexing deliveries."""

from __future__ import annotations

import json
import logging
from collections.abc import Callable, Generator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from typing import cast

from celery import signature

from configs import dify_config
from extensions.ext_redis import redis_client
from libs.acknowledged_task_queue import (
    AcknowledgedTaskClaim,
    AcknowledgedTaskClaimAlreadyActiveError,
    AcknowledgedTaskClaimLostError,
    AcknowledgedTaskQueue,
    RedisScripts,
    dispatch_acknowledged_claims,
)
from services.knowledge.task_outbox.contracts import KnowledgeTaskDeliveryHandledError
from services.knowledge.task_outbox.execution import EXECUTION_LEASE_SECONDS

logger = logging.getLogger(__name__)

_EXECUTION_LEASE_MARGIN_SECONDS = 60
# The queue remains authoritative slightly longer than the database execution
# lease. Every database renewal first verifies and renews this claim.
_CLAIM_LEASE_SECONDS = EXECUTION_LEASE_SECONDS + _EXECUTION_LEASE_MARGIN_SECONDS
_CLAIM_HEARTBEAT_SECONDS = 30
assert _CLAIM_LEASE_SECONDS > EXECUTION_LEASE_SECONDS

KNOWLEDGE_TASK_V2_QUEUE = "dataset_v2"
KNOWLEDGE_TASK_SUMMARY_V2_QUEUE = "dataset_summary_v2"
KNOWLEDGE_TASK_PRIORITY_V2_QUEUE = "priority_dataset_v2"


@dataclass(frozen=True, slots=True)
class KnowledgeTenantTask:
    task_name: str
    queue_name: str
    args: tuple[object, ...]
    task_id: str

    def serialize(self) -> str:
        return json.dumps(
            {
                "task_name": self.task_name,
                "queue_name": self.queue_name,
                "args": self.args,
                "task_id": self.task_id,
            },
            separators=(",", ":"),
        )

    @classmethod
    def deserialize(cls, value: str) -> KnowledgeTenantTask:
        payload = json.loads(value)
        if not isinstance(payload, dict):
            raise ValueError("Knowledge tenant task must be an object")
        task_name = payload.get("task_name")
        queue_name = payload.get("queue_name")
        args = payload.get("args")
        task_id = payload.get("task_id")
        if not isinstance(task_name, str) or not task_name:
            raise ValueError("Knowledge tenant task requires task_name")
        if not isinstance(queue_name, str) or not queue_name:
            raise ValueError("Knowledge tenant task requires queue_name")
        if not isinstance(args, list):
            raise ValueError("Knowledge tenant task requires args")
        if not isinstance(task_id, str) or not task_id:
            raise ValueError("Knowledge tenant task requires task_id")
        return cls(
            task_name=task_name,
            queue_name=queue_name,
            args=tuple(cast(list[object], args)),
            task_id=task_id,
        )


KnowledgeTenantTaskClaim = AcknowledgedTaskClaim[KnowledgeTenantTask]


class KnowledgeTenantTaskQueue(AcknowledgedTaskQueue[KnowledgeTenantTask]):
    def __init__(
        self,
        tenant_id: str,
        *,
        redis: RedisScripts = redis_client,
        token_factory: Callable[[], str] | None = None,
        lease_seconds: int = _CLAIM_LEASE_SECONDS,
        heartbeat_seconds: int = _CLAIM_HEARTBEAT_SECONDS,
    ) -> None:
        super().__init__(
            tenant_id,
            namespace="knowledge",
            serialize=KnowledgeTenantTask.serialize,
            deserialize=KnowledgeTenantTask.deserialize,
            identity=lambda task: task.task_id,
            redis=redis,
            token_factory=token_factory,
            lease_seconds=lease_seconds,
            heartbeat_seconds=heartbeat_seconds,
        )

    @classmethod
    def registered_tenants(
        cls,
        *,
        redis: RedisScripts = redis_client,
        batch_size: int = 500,
    ) -> tuple[str, ...]:
        return cls.registered_scopes(namespace="knowledge", redis=redis, batch_size=batch_size)


class KnowledgeTenantTaskAlreadyEnqueuedError(RuntimeError):
    """The Redis queue still owns an earlier delivery for this durable intent."""


@dataclass(frozen=True, slots=True)
class KnowledgeTenantTaskLease:
    _queue: KnowledgeTenantTaskQueue | None
    _receipt: str | None

    @classmethod
    def untracked(cls) -> KnowledgeTenantTaskLease:
        return cls(_queue=None, _receipt=None)

    def assert_owned(self) -> None:
        if self._queue is None:
            return
        assert self._receipt is not None
        if not self._queue.renew(self._receipt):
            raise AcknowledgedTaskClaimLostError(f"knowledge tenant queue claim is no longer owned: {self._receipt}")


def dispatch_knowledge_task_claims(
    *,
    tenant_id: str,
    queue: KnowledgeTenantTaskQueue,
    claims: Sequence[KnowledgeTenantTaskClaim],
) -> int:
    def publish(claim: KnowledgeTenantTaskClaim) -> None:
        task = claim.task
        signature(task.task_name, queue=task.queue_name).apply_async(
            args=task.args,
            kwargs={"tenant_queue_receipt": claim.receipt},
            task_id=task.task_id,
        )

    return dispatch_acknowledged_claims(
        queue=queue,
        claims=claims,
        publish=publish,
        description=f"knowledge indexing tasks for tenant {tenant_id}",
    )


def enqueue_knowledge_tenant_task(
    tenant_id: str,
    task: KnowledgeTenantTask,
    *,
    concurrency: int | None = None,
) -> int:
    queue = KnowledgeTenantTaskQueue(tenant_id)
    limit = concurrency if concurrency is not None else dify_config.TENANT_ISOLATED_TASK_CONCURRENCY
    enqueue = queue.enqueue_with_status(
        task,
        concurrency=limit,
    )
    dispatched = dispatch_knowledge_task_claims(tenant_id=tenant_id, queue=queue, claims=enqueue.claims)
    if not enqueue.accepted:
        raise KnowledgeTenantTaskAlreadyEnqueuedError(
            f"knowledge task delivery is still owned by the tenant queue: {task.task_id}"
        )
    return dispatched


def recover_knowledge_tenant_tasks(*, concurrency: int | None = None) -> int:
    limit = concurrency if concurrency is not None else dify_config.TENANT_ISOLATED_TASK_CONCURRENCY
    dispatched = 0
    for tenant_id in KnowledgeTenantTaskQueue.registered_tenants():
        queue = KnowledgeTenantTaskQueue(tenant_id)
        claims = queue.recover(concurrency=limit)
        dispatched += dispatch_knowledge_task_claims(tenant_id=tenant_id, queue=queue, claims=claims)
    return dispatched


@contextmanager
def knowledge_tenant_task_admission(
    tenant_id: str,
    receipt: str | None,
    *,
    concurrency: int | None = None,
) -> Generator[KnowledgeTenantTaskLease | None]:
    """Own a tenant capacity claim before a durable execution attempt begins."""

    if receipt is None:
        yield KnowledgeTenantTaskLease.untracked()
        return

    queue = KnowledgeTenantTaskQueue(tenant_id)
    try:
        queue.start(receipt)
    except (AcknowledgedTaskClaimAlreadyActiveError, AcknowledgedTaskClaimLostError):
        logger.info("Skipping inactive or duplicate knowledge tenant queue claim: %s", receipt)
        yield None
        return

    limit = concurrency if concurrency is not None else dify_config.TENANT_ISOLATED_TASK_CONCURRENCY
    completion_succeeded = False
    lease = KnowledgeTenantTaskLease(_queue=queue, _receipt=receipt)
    try:
        with queue.heartbeat(receipt):
            try:
                yield lease
            except KnowledgeTaskDeliveryHandledError:
                _complete_knowledge_tenant_claim(queue, tenant_id, receipt, concurrency=limit)
                completion_succeeded = True
                raise
            else:
                _complete_knowledge_tenant_claim(queue, tenant_id, receipt, concurrency=limit)
                completion_succeeded = True
    except Exception:
        if not completion_succeeded:
            try:
                queue.reset_active(receipt)
            except Exception:
                logger.exception("Failed to reset knowledge tenant queue claim after delivery failure: %s", receipt)
        raise


def _complete_knowledge_tenant_claim(
    queue: KnowledgeTenantTaskQueue,
    tenant_id: str,
    receipt: str,
    *,
    concurrency: int,
) -> None:
    completion = queue.complete(receipt, concurrency=concurrency)
    dispatch_knowledge_task_claims(
        tenant_id=tenant_id,
        queue=queue,
        claims=completion.next_claims,
    )
