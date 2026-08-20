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
                metadata={**source.metadata, "preview": False, _PENDING_IMPORT_KEY: pending_import},
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
    """Restore server reconciliation when a failed committed import is retried."""

    if workflow.source_id is None:
        return
    source = facade.get_source(
        tenant_id=tenant_id,
        account_id=account_id,
        control_space_id=control_space_id,
        source_id=workflow.source_id,
    )
    last_import = source.metadata.get("lastImport")
    if not isinstance(last_import, dict) or last_import.get("kind") not in _ASYNC_IMPORT_KINDS:
        return
    pending_import = {
        "kind": last_import.get("kind"),
        **(
            {"previewWorkflowId": last_import.get("previewWorkflowId")}
            if last_import.get("previewWorkflowId") is not None
            else {}
        ),
        "workflowId": workflow.id,
        "syncPolicy": last_import.get("syncPolicy"),
    }
    metadata = dict(source.metadata)
    metadata.pop("lastImport", None)
    facade.update_source(
        tenant_id=tenant_id,
        account_id=account_id,
        control_space_id=control_space_id,
        source_id=source.id,
        payload=KnowledgeFSSourceUpdatePayload(
            expectedVersion=source.version,
            metadata={**metadata, "preview": False, _PENDING_IMPORT_KEY: pending_import},
            status="syncing",
        ),
    )
    from tasks.knowledge_fs_source_import_tasks import finalize_source_import

    finalize_source_import.delay(
        tenant_id=tenant_id,
        account_id=account_id,
        control_space_id=control_space_id,
        source_id=source.id,
        workflow_id=workflow.id,
    )


__all__ = ["commit_source_import", "resume_committed_source_import"]
