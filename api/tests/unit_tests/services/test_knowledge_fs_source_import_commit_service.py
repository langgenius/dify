from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from services.knowledge_fs.product_dto import KnowledgeFSAsyncSourceImportPayload
from services.knowledge_fs.source_import_commit_service import (
    commit_source_import,
    resume_committed_source_import,
)


def test_commit_crawl_preview_selection_makes_source_visible_and_dispatches_reconciler() -> None:
    facade = MagicMock()
    facade.get_source_workflow.return_value = SimpleNamespace(source_id="source-1")
    facade.select_crawl_preview_pages.return_value = SimpleNamespace(id="import-1", source_id="source-1")
    facade.get_source.return_value = SimpleNamespace(
        id="source-1", metadata={"preview": True}, status="disabled", version=3
    )
    payload = KnowledgeFSAsyncSourceImportPayload.model_validate(
        {
            "kind": "crawl-preview-selection",
            "pageIds": ["page-1"],
            "previewWorkflowId": "preview-1",
            "syncPolicy": {"enabled": False, "mode": "manual"},
        }
    ).root

    with patch("tasks.knowledge_fs_source_import_tasks.finalize_source_import.delay") as delay:
        result = commit_source_import(
            facade=facade,
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            source_id="source-1",
            payload=payload,
            idempotency_key="request-1",
        )

    assert result.id == "import-1"
    selection = facade.select_crawl_preview_pages.call_args.kwargs
    assert selection["payload"].page_ids == ["page-1"]
    source_update = facade.update_source.call_args.kwargs["payload"]
    assert source_update.status == "syncing"
    assert source_update.metadata["preview"] is False
    assert source_update.metadata["pendingImport"] == {
        "kind": "crawl-preview-selection",
        "previewWorkflowId": "preview-1",
        "workflowId": "import-1",
        "syncPolicy": {"customIntervalSeconds": None, "enabled": False, "mode": "manual"},
    }
    delay.assert_called_once_with(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        source_id="source-1",
        workflow_id="import-1",
    )


def test_commit_online_document_import_uses_same_async_reconciliation() -> None:
    facade = MagicMock()
    facade.import_source_workflow.return_value = SimpleNamespace(id="import-1", source_id="source-1")
    facade.get_source.return_value = SimpleNamespace(
        id="source-1", metadata={"preview": True}, status="disabled", version=3
    )
    payload = KnowledgeFSAsyncSourceImportPayload.model_validate(
        {
            "kind": "online-document-import",
            "items": [
                {
                    "pageId": "page-1",
                    "providerItemId": "provider-page-1",
                    "type": "page",
                    "workspaceId": "workspace-1",
                }
            ],
            "syncPolicy": {"enabled": True, "mode": "provider"},
        }
    ).root

    with patch("tasks.knowledge_fs_source_import_tasks.finalize_source_import.delay"):
        commit_source_import(
            facade=facade,
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            source_id="source-1",
            payload=payload,
            idempotency_key="request-1",
        )

    workflow_payload = facade.import_source_workflow.call_args.kwargs["payload"].root
    assert workflow_payload.kind == "online-document-import"
    assert workflow_payload.items[0].page_id == "page-1"
    pending = facade.update_source.call_args.kwargs["payload"].metadata["pendingImport"]
    assert pending["kind"] == "online-document-import"
    assert "previewWorkflowId" not in pending


def test_commit_online_drive_import_uses_same_async_reconciliation() -> None:
    facade = MagicMock()
    facade.import_source_workflow.return_value = SimpleNamespace(id="import-1", source_id="source-1")
    facade.get_source.return_value = SimpleNamespace(
        id="source-1", metadata={"preview": True}, status="disabled", version=3
    )
    payload = KnowledgeFSAsyncSourceImportPayload.model_validate(
        {
            "kind": "online-drive-import",
            "items": [{"id": "file-1", "name": "Plan.pdf", "providerItemId": "provider-file-1"}],
            "syncPolicy": {"enabled": False, "mode": "manual"},
        }
    ).root

    with patch("tasks.knowledge_fs_source_import_tasks.finalize_source_import.delay"):
        commit_source_import(
            facade=facade,
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            source_id="source-1",
            payload=payload,
            idempotency_key="request-1",
        )

    workflow_payload = facade.import_source_workflow.call_args.kwargs["payload"].root
    assert workflow_payload.kind == "online-drive-import"
    assert workflow_payload.items[0].id == "file-1"
    pending = facade.update_source.call_args.kwargs["payload"].metadata["pendingImport"]
    assert pending["kind"] == "online-drive-import"


def test_resume_committed_source_import_restores_pending_marker() -> None:
    facade = MagicMock()
    facade.get_source.return_value = SimpleNamespace(
        id="source-1",
        metadata={
            "preview": False,
            "lastImport": {
                "kind": "crawl-preview-selection",
                "previewWorkflowId": "preview-1",
                "syncPolicy": {"enabled": False, "mode": "manual"},
                "workflowId": "import-1",
            },
        },
        status="error",
        version=5,
    )
    workflow = SimpleNamespace(id="import-1", source_id="source-1")

    with patch("tasks.knowledge_fs_source_import_tasks.finalize_source_import.delay") as delay:
        resume_committed_source_import(
            facade=facade,
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            workflow=workflow,
        )

    update = facade.update_source.call_args.kwargs["payload"]
    assert update.status == "syncing"
    assert "lastImport" not in update.metadata
    assert update.metadata["pendingImport"]["workflowId"] == "import-1"
    delay.assert_called_once()
