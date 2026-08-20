"""Durable reconciliation for Add source imports submitted from preview."""

from __future__ import annotations

from celery import shared_task

from core.db.session_factory import session_factory
from services.knowledge_fs.product_dto import (
    KnowledgeFSDeferredSyncPolicyPayload,
    KnowledgeFSSourceSyncPolicyPayload,
    KnowledgeFSSourceUpdatePayload,
)
from services.knowledge_fs.product_remote import KnowledgeFSProductRemoteError, KnowledgeFSProductResourceNotFoundError
from services.knowledge_fs.runtime import get_knowledge_fs_runtime

_ACTIVE_STATES = {"queued", "running", "crawling", "importing", "syncing"}
_PENDING_IMPORT_KEY = "pendingImport"


class KnowledgeFSSourceImportNotReadyError(RuntimeError):
    pass


def finalize_source_import_once(
    *, tenant_id: str, account_id: str, control_space_id: str, source_id: str, workflow_id: str
) -> str:
    facade = get_knowledge_fs_runtime(session_factory.get_session_maker()).facade
    workflow = facade.get_source_workflow(
        tenant_id=tenant_id,
        account_id=account_id,
        control_space_id=control_space_id,
        run_id=workflow_id,
    )
    if workflow.state in _ACTIVE_STATES:
        raise KnowledgeFSSourceImportNotReadyError("KnowledgeFS Source import is still running")

    source = facade.get_source(
        tenant_id=tenant_id,
        account_id=account_id,
        control_space_id=control_space_id,
        source_id=source_id,
    )
    pending = source.metadata.get(_PENDING_IMPORT_KEY)
    if not isinstance(pending, dict) or pending.get("workflowId") != workflow_id:
        return workflow_id

    metadata = dict(source.metadata)
    metadata.pop(_PENDING_IMPORT_KEY, None)
    if workflow.state != "completed":
        failure = {
            "errorCode": workflow.last_error_code,
            "errorMessage": workflow.failure.message if workflow.failure is not None else None,
            "kind": pending.get("kind"),
            "previewWorkflowId": pending.get("previewWorkflowId"),
            "state": workflow.state,
            "syncPolicy": pending.get("syncPolicy"),
            "workflowId": workflow.id,
        }
        facade.update_source(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            source_id=source_id,
            payload=KnowledgeFSSourceUpdatePayload(
                expectedVersion=source.version,
                metadata={**metadata, "lastImport": failure, "preview": False},
                status="error",
            ),
        )
        return workflow_id

    desired_policy = KnowledgeFSDeferredSyncPolicyPayload.model_validate(pending.get("syncPolicy"))
    try:
        current_policy = facade.get_source_sync_policy(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            source_id=source_id,
        )
        expected_revision = current_policy.revision
    except KnowledgeFSProductResourceNotFoundError:
        expected_revision = 0
    facade.update_source_sync_policy(
        tenant_id=tenant_id,
        account_id=account_id,
        control_space_id=control_space_id,
        source_id=source_id,
        payload=KnowledgeFSSourceSyncPolicyPayload(
            enabled=desired_policy.enabled,
            mode=desired_policy.mode,
            customIntervalSeconds=desired_policy.custom_interval_seconds,
            expectedRevision=expected_revision,
            expectedSourceVersion=source.version,
        ),
    )
    facade.update_source(
        tenant_id=tenant_id,
        account_id=account_id,
        control_space_id=control_space_id,
        source_id=source_id,
        payload=KnowledgeFSSourceUpdatePayload(
            expectedVersion=source.version,
            metadata={**metadata, "preview": False},
            status="active",
        ),
    )
    return workflow_id


@shared_task(bind=True, queue="knowledge_fs_lifecycle", max_retries=300, default_retry_delay=2)
def finalize_source_import(
    self, *, tenant_id: str, account_id: str, control_space_id: str, source_id: str, workflow_id: str
) -> str:
    try:
        return finalize_source_import_once(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            source_id=source_id,
            workflow_id=workflow_id,
        )
    except (KnowledgeFSSourceImportNotReadyError, KnowledgeFSProductRemoteError) as exc:
        raise self.retry(exc=exc)


__all__ = ["finalize_source_import", "finalize_source_import_once"]
