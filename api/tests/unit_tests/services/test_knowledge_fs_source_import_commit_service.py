from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from services.knowledge_fs.product_dto import KnowledgeFSAsyncSourceImportPayload
from services.knowledge_fs.product_remote import KnowledgeFSProductRequestRejectedError
from services.knowledge_fs.source_import_commit_service import (
    commit_source_import,
    resume_committed_source_import,
    retry_or_resume_source_workflow,
)


def test_commit_crawl_preview_selection_makes_source_visible_and_dispatches_reconciler() -> None:
    facade = MagicMock()
    facade.get_source_workflow.return_value = SimpleNamespace(source_id="source-1")
    facade.select_crawl_preview_pages.return_value = SimpleNamespace(id="import-1", source_id="source-1")
    facade.get_source.return_value = SimpleNamespace(
        id="source-1",
        metadata={"parameters": {"limit": 99}, "preview": True},
        status="disabled",
        version=3,
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
    assert "parameters" not in source_update.metadata
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


def test_commit_website_url_selection_uses_same_async_reconciliation() -> None:
    facade = MagicMock()
    facade.import_selected_source_crawl.return_value = SimpleNamespace(id="import-1", source_id="source-1")
    facade.get_source.return_value = SimpleNamespace(
        id="source-1", metadata={"preview": True}, status="disabled", version=3
    )
    payload = KnowledgeFSAsyncSourceImportPayload.model_validate(
        {
            "kind": "website-crawl-import",
            "sourceUrls": ["https://example.com/a"],
            "syncPolicy": {"enabled": True, "mode": "interval"},
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

    crawl_payload = facade.import_selected_source_crawl.call_args.kwargs["payload"]
    assert crawl_payload.source_urls == ["https://example.com/a"]
    pending = facade.update_source.call_args.kwargs["payload"].metadata["pendingImport"]
    assert pending["kind"] == "website-crawl-import"


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
            "syncPolicy": {"enabled": True, "mode": "interval"},
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
            "parameters": {"limit": 99},
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
    assert "parameters" not in update.metadata
    assert update.metadata["lastImport"] is None
    assert update.metadata["pendingImport"]["workflowId"] == "import-1"
    delay.assert_called_once()


def test_resume_committed_source_import_redispatches_an_existing_pending_marker() -> None:
    facade = MagicMock()
    facade.get_source.return_value = SimpleNamespace(
        id="source-1",
        metadata={
            "preview": False,
            "pendingImport": {
                "kind": "crawl-preview-selection",
                "previewWorkflowId": "preview-1",
                "syncPolicy": {"enabled": False, "mode": "manual"},
                "workflowId": "import-1",
            },
        },
        status="syncing",
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

    facade.update_source.assert_not_called()
    delay.assert_called_once_with(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        source_id="source-1",
        workflow_id="import-1",
    )


def test_resume_committed_source_import_redispatches_after_source_revision_conflict() -> None:
    facade = MagicMock()
    facade.get_source.return_value = SimpleNamespace(
        id="source-1",
        metadata={
            "lastImport": {
                "kind": "crawl-preview-selection",
                "syncPolicy": {"enabled": False, "mode": "manual"},
                "workflowId": "import-1",
            },
        },
        status="error",
        version=5,
    )
    facade.update_source.side_effect = KnowledgeFSProductRequestRejectedError(status_code=409)

    with patch("tasks.knowledge_fs_source_import_tasks.finalize_source_import.delay") as delay:
        resume_committed_source_import(
            facade=facade,
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            workflow=SimpleNamespace(id="import-1", source_id="source-1"),
        )

    delay.assert_called_once_with(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        source_id="source-1",
        workflow_id="import-1",
    )


def test_resume_committed_source_import_ignores_a_different_workflow_marker() -> None:
    facade = MagicMock()
    facade.get_source.return_value = SimpleNamespace(
        id="source-1",
        metadata={
            "lastImport": {
                "kind": "crawl-preview-selection",
                "syncPolicy": {"enabled": False, "mode": "manual"},
                "workflowId": "other-import",
            },
        },
        status="error",
        version=5,
    )

    with patch("tasks.knowledge_fs_source_import_tasks.finalize_source_import.delay") as delay:
        resume_committed_source_import(
            facade=facade,
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            workflow=SimpleNamespace(id="import-1", source_id="source-1"),
        )

    facade.update_source.assert_not_called()
    delay.assert_not_called()


def test_retry_or_resume_reconciles_an_already_completed_import() -> None:
    facade = MagicMock()
    workflow = SimpleNamespace(id="import-1", source_id="source-1", state="completed")
    facade.get_source_workflow.return_value = workflow
    facade.get_source.return_value = SimpleNamespace(
        id="source-1",
        metadata={
            "lastImport": {
                "kind": "crawl-preview-selection",
                "syncPolicy": {"enabled": False, "mode": "manual"},
                "workflowId": "import-1",
            },
        },
        status="error",
        version=5,
    )

    with patch("tasks.knowledge_fs_source_import_tasks.finalize_source_import.delay") as delay:
        result = retry_or_resume_source_workflow(
            facade=facade,
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            run_id="import-1",
        )

    assert result is workflow
    facade.retry_source_workflow.assert_not_called()
    assert facade.update_source.call_args.kwargs["payload"].status == "syncing"
    delay.assert_called_once()


def test_retry_or_resume_reconciles_a_concurrently_completed_import_after_conflict() -> None:
    facade = MagicMock()
    failed = SimpleNamespace(id="import-1", source_id="source-1", state="failed")
    completed = SimpleNamespace(id="import-1", source_id="source-1", state="completed")
    facade.get_source_workflow.side_effect = [failed, completed]
    facade.retry_source_workflow.side_effect = KnowledgeFSProductRequestRejectedError(status_code=409)
    facade.get_source.return_value = SimpleNamespace(
        id="source-1",
        metadata={
            "lastImport": {
                "kind": "crawl-preview-selection",
                "syncPolicy": {"enabled": False, "mode": "manual"},
                "workflowId": "import-1",
            },
        },
        status="error",
        version=5,
    )

    with patch("tasks.knowledge_fs_source_import_tasks.finalize_source_import.delay"):
        result = retry_or_resume_source_workflow(
            facade=facade,
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            run_id="import-1",
        )

    assert result is completed
    assert facade.get_source_workflow.call_count == 2
