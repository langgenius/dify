"""Server-owned commit boundary for durable Add source imports."""

from __future__ import annotations

from services.knowledge_fs.product_dto import (
    KnowledgeFSAsyncCrawlPreviewImportPayload,
    KnowledgeFSAsyncOnlineDocumentImportPayload,
    KnowledgeFSAsyncOnlineDriveImportPayload,
    KnowledgeFSAsyncSourceImport,
    KnowledgeFSCrawlPreviewSelectionPayload,
    KnowledgeFSOnlineDocumentWorkflowImportPayload,
    KnowledgeFSOnlineDriveWorkflowImportPayload,
    KnowledgeFSSourceUpdatePayload,
    KnowledgeFSSourceWorkflowImportPayload,
    KnowledgeFSSourceWorkflowResponse,
)
from services.knowledge_fs.product_remote import KnowledgeFSProductRequestRejectedError

_ASYNC_IMPORT_KINDS = {
    "crawl-preview-selection",
    "online-document-import",
    "online-drive-import",
}
_PENDING_IMPORT_KEY = "pendingImport"


def commit_source_import(
    *,
    facade,
    tenant_id: str,
    account_id: str,
    control_space_id: str,
    source_id: str,
    payload: KnowledgeFSAsyncSourceImport,
    idempotency_key: str,
) -> KnowledgeFSSourceWorkflowResponse:
    """Start an import and transfer reconciliation ownership to the backend."""

    preview_workflow_id: str | None = None
    if isinstance(payload, KnowledgeFSAsyncCrawlPreviewImportPayload):
        preview_workflow_id = payload.preview_workflow_id
        preview_workflow = facade.get_source_workflow(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            run_id=preview_workflow_id,
        )
        if preview_workflow.source_id != source_id:
            raise ValueError("KnowledgeFS crawl preview workflow does not belong to this Source")
        import_workflow = facade.select_crawl_preview_pages(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            run_id=preview_workflow_id,
            payload=KnowledgeFSCrawlPreviewSelectionPayload(pageIds=payload.page_ids),
            idempotency_key=idempotency_key,
        )
    elif isinstance(payload, KnowledgeFSAsyncOnlineDocumentImportPayload):
        import_workflow = facade.import_source_workflow(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            source_id=source_id,
            payload=KnowledgeFSSourceWorkflowImportPayload(
                KnowledgeFSOnlineDocumentWorkflowImportPayload(
                    kind="online-document-import",
                    items=payload.items,
                )
            ),
            idempotency_key=idempotency_key,
        )
    elif isinstance(payload, KnowledgeFSAsyncOnlineDriveImportPayload):
        import_workflow = facade.import_source_workflow(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            source_id=source_id,
            payload=KnowledgeFSSourceWorkflowImportPayload(
                KnowledgeFSOnlineDriveWorkflowImportPayload(
                    kind="online-drive-import",
                    items=payload.items,
                )
            ),
            idempotency_key=idempotency_key,
        )
    else:
        raise TypeError("Unsupported KnowledgeFS async Source import")

    if import_workflow.source_id != source_id:
        raise RuntimeError("KnowledgeFS import workflow returned a different Source")
    source = facade.get_source(
        tenant_id=tenant_id,
        account_id=account_id,
        control_space_id=control_space_id,
        source_id=source_id,
    )
    pending_import = {
        "kind": payload.kind,
        **({"previewWorkflowId": preview_workflow_id} if preview_workflow_id is not None else {}),
        "workflowId": import_workflow.id,
        "syncPolicy": payload.sync_policy.model_dump(mode="json", by_alias=True),
    }
    if source.metadata.get(_PENDING_IMPORT_KEY) != pending_import or source.status != "syncing":
        facade.update_source(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            source_id=source.id,
            payload=KnowledgeFSSourceUpdatePayload(
                expectedVersion=source.version,
                metadata={"preview": False, _PENDING_IMPORT_KEY: pending_import},
                status="syncing",
            ),
        )

    from tasks.knowledge_fs_source_import_tasks import finalize_source_import

    finalize_source_import.delay(
        tenant_id=tenant_id,
        account_id=account_id,
        control_space_id=control_space_id,
        source_id=source_id,
        workflow_id=import_workflow.id,
    )
    return import_workflow


def resume_committed_source_import(
    *, facade, tenant_id: str, account_id: str, control_space_id: str, workflow: KnowledgeFSSourceWorkflowResponse
) -> None:
    """Restore server reconciliation when a committed import is retried or reconciled."""

    if workflow.source_id is None:
        return
    source = facade.get_source(
        tenant_id=tenant_id,
        account_id=account_id,
        control_space_id=control_space_id,
        source_id=workflow.source_id,
    )
    last_import = _matching_import_marker(source.metadata.get("lastImport"), workflow.id)
    current_pending_import = _matching_import_marker(source.metadata.get(_PENDING_IMPORT_KEY), workflow.id)
    import_marker = last_import or current_pending_import
    if import_marker is None:
        return
    pending_import = {
        "kind": import_marker.get("kind"),
        **(
            {"previewWorkflowId": import_marker.get("previewWorkflowId")}
            if import_marker.get("previewWorkflowId") is not None
            else {}
        ),
        "workflowId": workflow.id,
        "syncPolicy": import_marker.get("syncPolicy"),
    }
    if last_import is not None or current_pending_import != pending_import or source.status != "syncing":
        # updateSource merges metadata; null explicitly supersedes the terminal marker while retrying.
        try:
            facade.update_source(
                tenant_id=tenant_id,
                account_id=account_id,
                control_space_id=control_space_id,
                source_id=source.id,
                payload=KnowledgeFSSourceUpdatePayload(
                    expectedVersion=source.version,
                    metadata={"lastImport": None, "preview": False, _PENDING_IMPORT_KEY: pending_import},
                    status="syncing",
                ),
            )
        except KnowledgeFSProductRequestRejectedError as error:
            if error.status_code != 409:
                raise
            # A prior reconciler can finish its stale terminal write while retry is accepted.
            # The newly dispatched reconciler below re-reads both authorities and repairs it.
    from tasks.knowledge_fs_source_import_tasks import finalize_source_import

    finalize_source_import.delay(
        tenant_id=tenant_id,
        account_id=account_id,
        control_space_id=control_space_id,
        source_id=source.id,
        workflow_id=workflow.id,
    )


def retry_or_resume_source_workflow(
    *, facade, tenant_id: str, account_id: str, control_space_id: str, run_id: str
) -> KnowledgeFSSourceWorkflowResponse:
    """Retry a failed run, or reconcile an already-completed import idempotently."""

    workflow = facade.get_source_workflow(
        tenant_id=tenant_id,
        account_id=account_id,
        control_space_id=control_space_id,
        run_id=run_id,
    )
    if workflow.state != "completed":
        try:
            workflow = facade.retry_source_workflow(
                tenant_id=tenant_id,
                account_id=account_id,
                control_space_id=control_space_id,
                run_id=run_id,
            )
        except KnowledgeFSProductRequestRejectedError as error:
            if error.status_code != 409:
                raise
            # A concurrent retry may have completed between the authoritative read and mutation.
            workflow = facade.get_source_workflow(
                tenant_id=tenant_id,
                account_id=account_id,
                control_space_id=control_space_id,
                run_id=run_id,
            )
            if workflow.state != "completed":
                raise
    resume_committed_source_import(
        facade=facade,
        tenant_id=tenant_id,
        account_id=account_id,
        control_space_id=control_space_id,
        workflow=workflow,
    )
    return workflow


def _matching_import_marker(value: object, workflow_id: str) -> dict[str, object] | None:
    if (
        not isinstance(value, dict)
        or value.get("kind") not in _ASYNC_IMPORT_KINDS
        or value.get("workflowId") != workflow_id
    ):
        return None
    return value


__all__ = ["commit_source_import", "resume_committed_source_import", "retry_or_resume_source_workflow"]
