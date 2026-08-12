"""Asynchronously collect retired Agent working resources."""

from __future__ import annotations

import logging
from collections.abc import Iterable

from celery import shared_task

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
) -> None:
    """Collect only the explicitly identified RETIRED resources."""

    collectors = (
        (workspace_ids, "workspace_id", AgentWorkspaceService.collect_retired_workspace),
        (binding_ids, "binding_id", AgentWorkspaceService.collect_retired_binding),
        (
            home_snapshot_ids,
            "home_snapshot_id",
            AgentHomeSnapshotService.collect_retired_home_snapshot,
        ),
    )
    for resource_ids, argument_name, collector in collectors:
        for resource_id in resource_ids:
            try:
                collector(tenant_id=tenant_id, **{argument_name: resource_id})
            except Exception:
                logger.exception(
                    "Failed to collect retired Agent resource",
                    extra={
                        "tenant_id": tenant_id,
                        "resource_type": argument_name.removesuffix("_id"),
                        "resource_id": resource_id,
                    },
                )


def enqueue_agent_resource_collection(
    *,
    tenant_id: str,
    binding_ids: Iterable[str] = (),
    workspace_ids: Iterable[str] = (),
    home_snapshot_ids: Iterable[str] = (),
) -> None:
    """Best-effort enqueue of physical collection after retire has committed."""

    payload = {
        "binding_ids": sorted({resource_id for resource_id in binding_ids if resource_id}),
        "workspace_ids": sorted({resource_id for resource_id in workspace_ids if resource_id}),
        "home_snapshot_ids": sorted({resource_id for resource_id in home_snapshot_ids if resource_id}),
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


__all__ = ["collect_agent_resources", "enqueue_agent_resource_collection"]
