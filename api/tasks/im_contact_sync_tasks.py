"""Celery entrypoint for durable IM Contact synchronization runs."""

from __future__ import annotations

import logging

from celery import shared_task

from core.human_input_v2.shared import DeploymentScope, DirectoryScope, IMSyncRunId, TenantId, WorkspaceScope
from services.human_input_v2.im_contact_sync.coordinator import IMSyncRetryableError
from services.human_input_v2.im_contact_sync.worker import IMContactSyncWorker

logger = logging.getLogger(__name__)

_WORKSPACE_SCOPE_KIND = "workspace"
_DEPLOYMENT_SCOPE_KIND = "deployment"


def build_im_contact_sync_worker() -> IMContactSyncWorker:
    """Defer production composition until a worker delivery is actually claimed."""

    from services.human_input_v2.im_contact_sync.composition import build_im_contact_sync_worker as build_worker

    return build_worker()


@shared_task(
    queue="human_input_contact_sync",
    autoretry_for=(IMSyncRetryableError,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 5},
)
def reconcile_im_contacts_task(sync_run_id: str, scope_kind: str, tenant_id: str | None) -> str:
    """Accept durable identifiers and return the persisted terminal run status."""

    scope = _scope_from_payload(scope_kind, tenant_id)
    logger.info("IM Contact sync task received, sync_run_id=%s", sync_run_id)
    terminal_run = build_im_contact_sync_worker().execute(IMSyncRunId(sync_run_id), scope)
    logger.info(
        "IM Contact sync task completed, sync_run_id=%s, integration_id=%s, status=%s",
        terminal_run.id,
        terminal_run.integration_revision.integration_id,
        terminal_run.status.value,
    )
    return terminal_run.status.value


def _scope_from_payload(scope_kind: str, tenant_id: str | None) -> DirectoryScope:
    if scope_kind == _WORKSPACE_SCOPE_KIND and tenant_id is not None:
        return WorkspaceScope(id=TenantId(tenant_id))
    if scope_kind == _DEPLOYMENT_SCOPE_KIND and tenant_id is None:
        return DeploymentScope()
    raise ValueError("invalid Organization scope payload")


__all__ = ["reconcile_im_contacts_task"]
