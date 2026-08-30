"""Durable reconciliation for Add source imports submitted from preview."""

from __future__ import annotations

from celery import shared_task

from core.db.session_factory import session_factory
from services.knowledge_fs.product_dto import (
    KnowledgeFSDeferredSyncPolicyPayload,
    KnowledgeFSSourceSyncPolicyPayload,
    KnowledgeFSSourceUpdatePayload,
)
from services.knowledge_fs.product_remote import (
    KnowledgeFSProductRemoteError,
    KnowledgeFSProductRequestRejectedError,
    KnowledgeFSProductResourceNotFoundError,
)
from services.knowledge_fs.runtime import get_knowledge_fs_runtime

_ACTIVE_STATES = {"queued", "running", "crawling", "importing", "syncing"}
_ASYNC_IMPORT_KINDS = {
    "crawl-preview-selection",
    "website-crawl-import",
    "online-document-import",
    "online-drive-import",
}
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
    pending = _matching_import_marker(source.metadata.get(_PENDING_IMPORT_KEY), workflow_id)
    last_import = _matching_import_marker(source.metadata.get("lastImport"), workflow_id)
    completed_import = last_import if last_import is not None and last_import.get("state") == "completed" else None
    if pending is None and last_import is None:
        return workflow_id

    if workflow.state != "completed":
        if pending is None:
            return workflow_id
        # updateSource applies a metadata merge patch, so omission preserves the old marker.
        # An explicit null is the tombstone consumed by Dify/UI readers.
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
                metadata={_PENDING_IMPORT_KEY: None, "lastImport": failure, "preview": False},
                status="error",
            ),
        )
        return workflow_id

    import_metadata = completed_import or pending or last_import
    if import_metadata is None:
        return workflow_id
    if completed_import is None:
        completion = {
            "kind": import_metadata.get("kind"),
            **(
                {"previewWorkflowId": import_metadata.get("previewWorkflowId")}
                if import_metadata.get("previewWorkflowId") is not None
                else {}
            ),
            "state": "completed",
            "syncPolicy": import_metadata.get("syncPolicy"),
            "workflowId": workflow.id,
        }
        source = facade.update_source(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            source_id=source_id,
            payload=KnowledgeFSSourceUpdatePayload(
                expectedVersion=source.version,
                metadata={_PENDING_IMPORT_KEY: None, "lastImport": completion, "preview": False},
                status="active",
            ),
        )
        import_metadata = completion

    desired_policy = KnowledgeFSDeferredSyncPolicyPayload.model_validate(import_metadata.get("syncPolicy"))
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
    return workflow_id


def _matching_import_marker(value: object, workflow_id: str) -> dict[str, object] | None:
    if (
        not isinstance(value, dict)
        or value.get("kind") not in _ASYNC_IMPORT_KINDS
        or value.get("workflowId") != workflow_id
    ):
        return None
    return value


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
    except KnowledgeFSProductRequestRejectedError as exc:
        if exc.status_code != 409:
            raise
        raise self.retry(exc=exc)


__all__ = ["finalize_source_import", "finalize_source_import_once"]
