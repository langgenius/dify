"""Collect retired Agent data under a two-phase task contract.

Phase one attempts every explicitly identified RETIRED working resource. Phase
two purges the requested archived Agent aggregates only after the whole first
phase succeeds. Any collection failure skips aggregate purge and is included in
the error raised after all explicit resources have been attempted.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable

from celery import shared_task

from core.db.session_factory import session_factory
from repositories.agent_build_collection_repository import (
    AgentBuildCollectionIntent,
    AgentBuildCollectionRepository,
)

logger = logging.getLogger(__name__)


@shared_task(
    queue="retention",
    autoretry_for=(Exception,),
    max_retries=5,
    retry_backoff=30,
    retry_backoff_max=10 * 60,
)
def collect_agent_resources(
    *,
    tenant_id: str,
    binding_ids: list[str],
    workspace_ids: list[str],
    home_snapshot_ids: list[str],
    purge_agent_ids: list[str] | None = None,
) -> None:
    """Collect the explicit RETIRED batch, then purge Agents only on full success.

    Collection is best-effort across the complete explicit batch so one failed
    resource does not hide later failures. If any resource fails, aggregate
    purge is skipped and the summary error retries the batch. The resource
    collectors accept already-removed IDs so redelivering the batch is safe.
    The task stops retrying after five attempts beyond the initial delivery.
    """

    # Agent retirement services also import the enqueue function in this module.
    from services.agent.deletion_service import AgentDeletionService
    from services.agent.home_snapshot_service import AgentHomeSnapshotService
    from services.agent.workspace_service import AgentWorkspaceService

    collectors = (
        (workspace_ids, "workspace_id", AgentWorkspaceService.collect_retired_workspace),
        (binding_ids, "binding_id", AgentWorkspaceService.collect_retired_binding),
        (
            home_snapshot_ids,
            "home_snapshot_id",
            AgentHomeSnapshotService.collect_retired_home_snapshot,
        ),
    )
    failures: list[str] = []
    first_error: Exception | None = None
    for resource_ids, argument_name, collector in collectors:
        for resource_id in resource_ids:
            try:
                collector(tenant_id=tenant_id, **{argument_name: resource_id})
            except Exception as exc:
                resource_type = argument_name.removesuffix("_id")
                failures.append(f"{resource_type}:{resource_id}")
                if first_error is None:
                    first_error = exc
                logger.exception(
                    "Failed to collect retired Agent resource",
                    extra={
                        "tenant_id": tenant_id,
                        "resource_type": resource_type,
                        "resource_id": resource_id,
                    },
                )
    if failures:
        raise RuntimeError(
            f"Failed to collect {len(failures)} retired Agent resource(s): {', '.join(failures)}"
        ) from first_error
    AgentDeletionService.purge_archived_agents(tenant_id=tenant_id, agent_ids=purge_agent_ids or ())


def _publish_collection(
    *,
    tenant_id: str,
    payload: dict[str, list[str]],
    build_intents: Iterable[AgentBuildCollectionIntent],
) -> None:
    """Publish one batch while retaining every claimed Build intent on failure.

    Publication failure stores its exception type on each matching claim
    generation and re-raises. Successful publication does not acknowledge
    physical cleanup.
    """
    intents = tuple(build_intents)
    try:
        collect_agent_resources.delay(tenant_id=tenant_id, **payload)
    except Exception as exc:
        message = "Failed to enqueue retired Agent resource collection"
        extra: dict[str, object] = {"tenant_id": tenant_id, **payload}
        if intents:
            attempts = AgentBuildCollectionRepository(session_factory.get_session_maker())
            for intent in intents:
                attempts.record_error(intent=intent, error_type=type(exc).__name__)
            message = "Failed to publish Build collection attempt"
            extra["build_attempt_counts"] = [intent.attempt_count for intent in intents]
        logger.exception(message, extra=extra)
        raise


@shared_task(queue="retention", time_limit=60, soft_time_limit=55, ignore_result=True)
def reconcile_agent_build_collections(
    *,
    batch_size: int = 20,
    retry_interval_seconds: float = 300.0,
    max_attempts: int = 100,
) -> dict[str, int]:
    """Retry bounded Build dispatch claims while retaining exhausted rows.

    A batch claims each binding at most once, even with a zero retry interval.
    Repeated publication is possible; neither exactly-once delivery nor
    physical cleanup is guaranteed. The exhausted count covers only the bounded
    operator-review sample, not a full table count. Invalid batch or retry
    bounds raise ValueError.
    """
    if not 1 <= batch_size <= 100:
        raise ValueError("collection batch size must be between 1 and 100")
    repository = AgentBuildCollectionRepository(session_factory.get_session_maker())
    outcome = {"published": 0, "failed": 0, "exhausted": 0}
    claimed_binding_ids: set[str] = set()
    while (
        len(claimed_binding_ids) < batch_size
        and (
            intent := repository.claim_next(
                excluded_binding_ids=claimed_binding_ids,
                retry_interval_seconds=retry_interval_seconds,
                max_attempts=max_attempts,
            )
        )
        is not None
    ):
        claimed_binding_ids.add(intent.binding_id)
        try:
            _publish_collection(
                tenant_id=intent.tenant_id,
                payload={
                    "binding_ids": [intent.binding_id],
                    "workspace_ids": [],
                    "home_snapshot_ids": [],
                    "purge_agent_ids": [],
                },
                build_intents=(intent,),
            )
        except Exception:
            outcome["failed"] += 1
        else:
            outcome["published"] += 1
    exhausted = repository.exhausted(max_attempts=max_attempts)
    outcome["exhausted"] = len(exhausted)
    if exhausted:
        logger.error(
            "Build collection attempts exhausted; retained for operator review",
            extra={
                "binding_ids": [item.binding_id for item in exhausted],
                "last_error_types": sorted({item.last_error or "unknown" for item in exhausted}),
            },
        )
    return outcome


def enqueue_agent_resource_collection(
    *,
    tenant_id: str,
    binding_ids: Iterable[str] = (),
    workspace_ids: Iterable[str] = (),
    home_snapshot_ids: Iterable[str] = (),
    purge_agent_ids: Iterable[str] = (),
) -> None:
    """Publish retired resources after the caller's database commit.

    Build bindings use durable dispatch claims outside aggregate purge. A purge
    batch must retain all of its explicit prerequisites, even bindings with
    exhausted claims. Broker errors propagate; publication does not settle an
    intent or guarantee cleanup.
    """

    payload = {
        "binding_ids": sorted({resource_id for resource_id in binding_ids if resource_id}),
        "workspace_ids": sorted({resource_id for resource_id in workspace_ids if resource_id}),
        "home_snapshot_ids": sorted({resource_id for resource_id in home_snapshot_ids if resource_id}),
        "purge_agent_ids": sorted({agent_id for agent_id in purge_agent_ids if agent_id}),
    }
    if not any(payload.values()):
        return
    if payload["purge_agent_ids"] or not payload["binding_ids"]:
        _publish_collection(tenant_id=tenant_id, payload=payload, build_intents=())
        return
    repository = AgentBuildCollectionRepository(session_factory.get_session_maker())
    pending = repository.pending_binding_ids(tenant_id=tenant_id, binding_ids=set(payload["binding_ids"]))
    claimed: list[AgentBuildCollectionIntent] = []
    for binding_id in sorted(pending):
        intent = repository.claim_next(
            tenant_id=tenant_id,
            binding_id=binding_id,
            retry_interval_seconds=0.0,
        )
        if intent is not None:
            claimed.append(intent)
    claimed_binding_ids = {intent.binding_id for intent in claimed}
    payload["binding_ids"] = [
        binding_id
        for binding_id in payload["binding_ids"]
        if binding_id not in pending or binding_id in claimed_binding_ids
    ]
    if not any(payload.values()):
        return
    _publish_collection(tenant_id=tenant_id, payload=payload, build_intents=claimed)


__all__ = [
    "collect_agent_resources",
    "enqueue_agent_resource_collection",
    "reconcile_agent_build_collections",
]
