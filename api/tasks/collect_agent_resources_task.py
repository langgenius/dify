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

from services.agent.deletion_service import AgentDeletionService
from services.agent.home_snapshot_service import AgentHomeSnapshotService
from services.agent.workspace_service import AgentWorkspaceService

logger = logging.getLogger(__name__)


@shared_task(queue="retention")
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
    purge is skipped and one summary error is raised after all attempts.
    """

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


def enqueue_agent_resource_collection(
    *,
    tenant_id: str,
    binding_ids: Iterable[str] = (),
    workspace_ids: Iterable[str] = (),
    home_snapshot_ids: Iterable[str] = (),
    purge_agent_ids: Iterable[str] = (),
) -> None:
    """Enqueue physical collection after retirement has committed."""

    payload = {
        "binding_ids": sorted({resource_id for resource_id in binding_ids if resource_id}),
        "workspace_ids": sorted({resource_id for resource_id in workspace_ids if resource_id}),
        "home_snapshot_ids": sorted({resource_id for resource_id in home_snapshot_ids if resource_id}),
        "purge_agent_ids": sorted({agent_id for agent_id in purge_agent_ids if agent_id}),
    }
    if not any(payload.values()):
        return
    try:
        collect_agent_resources.delay(tenant_id=tenant_id, **payload)
    except Exception:
        logger.exception(
            "Failed to enqueue retired Agent resource collection",
            extra={"tenant_id": tenant_id, **payload},
        )
        raise


__all__ = ["collect_agent_resources", "enqueue_agent_resource_collection"]
