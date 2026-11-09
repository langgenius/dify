"""Composition adapters binding existing parent lifecycles to BYOA cleanup."""

from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Literal

from services.external_agents.retention import ExternalDeletionScope


def fence_external_parent(
    tenant_id: str,
    kind: Literal["tenant", "app", "workflow_run", "message", "invocation", "conversation", "context_slot"],
    owner_id: str,
) -> None:
    """Persist the parent tombstone before its existing destructive effects.

    This composition adapter resolves the registered use case lazily to avoid a
    construction cycle. Pure application owners receive it as a callback.
    """
    from extensions.ext_application_services import application_services

    application_services().external_agents.retention.delete_scope(
        ExternalDeletionScope(tenant_id, kind, owner_id), now=datetime.now(UTC)
    )


def fence_external_workspace(workspace_id: str) -> None:
    fence_external_parent(workspace_id, "tenant", workspace_id)


def fence_external_archived_runs(tenant_id: str, run_ids: Sequence[str]) -> None:
    """Permanent archive deletion owns these manifest-validated run identities."""
    for run_id in run_ids:
        fence_external_parent(tenant_id, "workflow_run", run_id)
