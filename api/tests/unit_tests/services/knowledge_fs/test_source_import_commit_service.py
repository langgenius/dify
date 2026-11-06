from collections import deque
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import cast
from unittest.mock import patch

import pytest

from services.knowledge_fs.product_dto import (
    KnowledgeFSAsyncSourceImportPayload,
    KnowledgeFSCrawlImportPayload,
    KnowledgeFSCrawlPreviewSelectionPayload,
    KnowledgeFSSourceUpdatePayload,
    KnowledgeFSSourceWorkflowImportPayload,
    KnowledgeFSSourceWorkflowResponse,
)
from services.knowledge_fs.product_remote import KnowledgeFSProductRequestRejectedError
from services.knowledge_fs.source_import_commit_service import (
    commit_source_import,
    resume_committed_source_import,
    retry_or_resume_source_workflow,
)
from tests.helpers.unit.services.knowledge_fs_services_a_fakes import CallRecorder, sent_payload


def source_workflow(**overrides: object) -> KnowledgeFSSourceWorkflowResponse:
    return KnowledgeFSSourceWorkflowResponse.model_validate(
        {
            "id": "workflow-1",
            "knowledge_space_id": "space-1",
            "kind": "import",
            "state": "running",
            "checkpoint": "pending",
            "execution_attempts": 0,
            "max_execution_attempts": 3,
            "progress_completed": 0,
            "progress_failed": 0,
            "progress_skipped": 0,
            "created_at": datetime(2026, 1, 1, tzinfo=UTC),
            "updated_at": datetime(2026, 1, 1, tzinfo=UTC),
            **overrides,
        }
    )


@dataclass(frozen=True)
class SourceSnapshot:
    """The Source fields the commit service reads back before writing the pending-import marker."""

    id: str
    metadata: dict[str, object]
    status: str
    version: int


@dataclass
class FakeSourceFacade:
    get_source_workflow: CallRecorder = field(default_factory=CallRecorder)
    select_crawl_preview_pages: CallRecorder = field(default_factory=CallRecorder)
    import_selected_source_crawl: CallRecorder = field(default_factory=CallRecorder)
    import_source_workflow: CallRecorder = field(default_factory=CallRecorder)
    retry_source_workflow: CallRecorder = field(default_factory=CallRecorder)
    get_source: CallRecorder = field(default_factory=CallRecorder)
    update_source: CallRecorder = field(default_factory=CallRecorder)


def _source_update(facade: FakeSourceFacade) -> KnowledgeFSSourceUpdatePayload:
    return sent_payload(facade.update_source, KnowledgeFSSourceUpdatePayload)


def _updated_metadata(facade: FakeSourceFacade) -> dict[str, object]:
    metadata = _source_update(facade).metadata
    assert metadata is not None
    return dict(metadata)


def _pending_import(facade: FakeSourceFacade) -> dict[str, object]:
    pending = _updated_metadata(facade)["pendingImport"]
    assert isinstance(pending, dict)
    return cast(dict[str, object], pending)


def test_commit_crawl_preview_selection_makes_source_visible_and_dispatches_reconciler() -> None:
    facade = FakeSourceFacade()
    facade.get_source_workflow.result = source_workflow(id="preview-1", source_id="source-1")
    facade.select_crawl_preview_pages.result = source_workflow(id="import-1", source_id="source-1")
    facade.get_source.result = SourceSnapshot(
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
    assert sent_payload(facade.select_crawl_preview_pages, KnowledgeFSCrawlPreviewSelectionPayload).page_ids == [
        "page-1"
    ]
    source_update = _source_update(facade)
    assert source_update.status == "syncing"
    assert "parameters" not in _updated_metadata(facade)
    assert _updated_metadata(facade)["preview"] is False
    assert _updated_metadata(facade)["pendingImport"] == {
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
    facade = FakeSourceFacade()
    facade.import_selected_source_crawl.result = source_workflow(id="import-1", source_id="source-1")
    facade.get_source.result = SourceSnapshot(id="source-1", metadata={"preview": True}, status="disabled", version=3)
    payload = KnowledgeFSAsyncSourceImportPayload.model_validate(
        {
            "kind": "website-crawl-import",
            "sourceUrls": ["https://example.com/a", "https://example.com/a"],
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

    crawl_payload = sent_payload(facade.import_selected_source_crawl, KnowledgeFSCrawlImportPayload)
    assert crawl_payload.source_urls == ["https://example.com/a", "https://example.com/a"]
    assert crawl_payload.replace_existing_selection is True
    pending = _pending_import(facade)
    assert pending["kind"] == "website-crawl-import"


def test_commit_online_document_import_uses_same_async_reconciliation() -> None:
    facade = FakeSourceFacade()
    facade.import_source_workflow.result = source_workflow(id="import-1", source_id="source-1")
    facade.get_source.result = SourceSnapshot(id="source-1", metadata={"preview": True}, status="disabled", version=3)
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

    workflow_payload = sent_payload(facade.import_source_workflow, KnowledgeFSSourceWorkflowImportPayload).root
    assert workflow_payload.kind == "online-document-import"
    assert workflow_payload.items[0].page_id == "page-1"
    pending = _pending_import(facade)
    assert pending["kind"] == "online-document-import"
    assert "previewWorkflowId" not in pending


def test_commit_online_drive_import_uses_same_async_reconciliation() -> None:
    facade = FakeSourceFacade()
    facade.import_source_workflow.result = source_workflow(id="import-1", source_id="source-1")
    facade.get_source.result = SourceSnapshot(id="source-1", metadata={"preview": True}, status="disabled", version=3)
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

    workflow_payload = sent_payload(facade.import_source_workflow, KnowledgeFSSourceWorkflowImportPayload).root
    assert workflow_payload.kind == "online-drive-import"
    assert workflow_payload.items[0].id == "file-1"
    pending = _pending_import(facade)
    assert pending["kind"] == "online-drive-import"


def test_resume_committed_source_import_restores_pending_marker() -> None:
    facade = FakeSourceFacade()
    facade.get_source.result = SourceSnapshot(
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
    workflow = source_workflow(id="import-1", source_id="source-1")

    with patch("tasks.knowledge_fs_source_import_tasks.finalize_source_import.delay") as delay:
        resume_committed_source_import(
            facade=facade,
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            workflow=workflow,
        )

    update = _source_update(facade)
    assert update.status == "syncing"
    assert "parameters" not in _updated_metadata(facade)
    assert _updated_metadata(facade)["lastImport"] is None
    assert _pending_import(facade)["workflowId"] == "import-1"
    delay.assert_called_once()


def test_resume_completed_initial_website_import_repairs_source_state() -> None:
    facade = FakeSourceFacade()
    facade.get_source.result = SourceSnapshot(
        id="source-1",
        metadata={
            "initialImport": {
                "state": "failed",
                "syncPolicy": {"enabled": True, "mode": "interval"},
                "workflowId": "import-1",
            },
            "preview": False,
            "providerKind": "website",
        },
        status="disabled",
        version=5,
    )

    with patch("tasks.knowledge_fs_source_import_tasks.finalize_source_import.delay") as delay:
        resume_committed_source_import(
            facade=facade,
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            workflow=source_workflow(id="import-1", source_id="source-1", state="completed"),
        )

    update = _source_update(facade)
    assert update.status == "syncing"
    assert _updated_metadata(facade)["initialImport"] is None
    assert _updated_metadata(facade)["pendingImport"] == {
        "kind": "website-crawl-import",
        "workflowId": "import-1",
        "syncPolicy": {"enabled": True, "mode": "interval"},
    }
    delay.assert_called_once_with(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        source_id="source-1",
        workflow_id="import-1",
    )


def test_resume_legacy_initial_website_import_falls_back_to_manual_sync() -> None:
    facade = FakeSourceFacade()
    facade.get_source.result = SourceSnapshot(
        id="source-1",
        metadata={
            "initialImport": {"state": "failed", "workflowId": "import-1"},
            "preview": False,
            "providerKind": "website",
        },
        status="disabled",
        version=5,
    )

    with patch("tasks.knowledge_fs_source_import_tasks.finalize_source_import.delay"):
        resume_committed_source_import(
            facade=facade,
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            workflow=source_workflow(id="import-1", source_id="source-1", state="completed"),
        )

    pending = _pending_import(facade)
    assert pending["syncPolicy"] == {"enabled": False, "mode": "manual"}


def test_resume_committed_source_import_redispatches_an_existing_pending_marker() -> None:
    facade = FakeSourceFacade()
    facade.get_source.result = SourceSnapshot(
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
    workflow = source_workflow(id="import-1", source_id="source-1")

    with patch("tasks.knowledge_fs_source_import_tasks.finalize_source_import.delay") as delay:
        resume_committed_source_import(
            facade=facade,
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            workflow=workflow,
        )

    assert facade.update_source.calls == []
    delay.assert_called_once_with(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        source_id="source-1",
        workflow_id="import-1",
    )


def test_resume_committed_source_import_redispatches_after_source_revision_conflict() -> None:
    facade = FakeSourceFacade()
    facade.get_source.result = SourceSnapshot(
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
    facade.update_source.error = KnowledgeFSProductRequestRejectedError(status_code=409)

    with patch("tasks.knowledge_fs_source_import_tasks.finalize_source_import.delay") as delay:
        resume_committed_source_import(
            facade=facade,
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            workflow=source_workflow(id="import-1", source_id="source-1"),
        )

    delay.assert_called_once_with(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        source_id="source-1",
        workflow_id="import-1",
    )


def test_resume_committed_source_import_redispatches_after_remote_update_failure() -> None:
    facade = FakeSourceFacade()
    facade.get_source.result = SourceSnapshot(
        id="source-1",
        metadata={
            "lastImport": {
                "kind": "online-document-import",
                "syncPolicy": {"enabled": True, "mode": "interval"},
                "workflowId": "import-1",
            },
        },
        status="error",
        version=5,
    )
    facade.update_source.error = RuntimeError("remote update failed after commit")

    with (
        patch("tasks.knowledge_fs_source_import_tasks.finalize_source_import.delay") as delay,
        pytest.raises(RuntimeError, match="remote update failed after commit"),
    ):
        resume_committed_source_import(
            facade=facade,
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            workflow=source_workflow(id="import-1", source_id="source-1"),
        )

    delay.assert_called_once_with(
        tenant_id="tenant-1",
        account_id="account-1",
        control_space_id="control-1",
        source_id="source-1",
        workflow_id="import-1",
    )


def test_resume_committed_source_import_ignores_a_different_workflow_marker() -> None:
    facade = FakeSourceFacade()
    facade.get_source.result = SourceSnapshot(
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
            workflow=source_workflow(id="import-1", source_id="source-1"),
        )

    assert facade.update_source.calls == []
    delay.assert_not_called()


def test_retry_or_resume_reconciles_an_already_completed_import() -> None:
    facade = FakeSourceFacade()
    workflow = source_workflow(id="import-1", source_id="source-1", state="completed")
    facade.get_source_workflow.result = workflow
    facade.get_source.result = SourceSnapshot(
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
    assert facade.retry_source_workflow.calls == []
    assert _source_update(facade).status == "syncing"
    delay.assert_called_once()


def test_retry_or_resume_reconciles_a_concurrently_completed_import_after_conflict() -> None:
    facade = FakeSourceFacade()
    failed = source_workflow(id="import-1", source_id="source-1", state="failed")
    completed = source_workflow(id="import-1", source_id="source-1", state="completed")
    facade.get_source_workflow.outcomes = deque([failed, completed])
    facade.retry_source_workflow.error = KnowledgeFSProductRequestRejectedError(status_code=409)
    facade.get_source.result = SourceSnapshot(
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
    assert len(facade.get_source_workflow.calls) == 2


@pytest.mark.parametrize(
    ("selection", "operation"),
    [
        ({"kind": "website-crawl-import", "sourceUrls": ["https://example.com/a"]}, "import_selected_source_crawl"),
        (
            {
                "kind": "online-document-import",
                "items": [
                    {"pageId": "page-1", "workspaceId": "workspace-1", "providerItemId": "provider-1", "type": "page"}
                ],
            },
            "import_source_workflow",
        ),
        (
            {
                "kind": "online-drive-import",
                "items": [{"id": "file-1", "name": "Plan.pdf", "providerItemId": "provider-1"}],
            },
            "import_source_workflow",
        ),
    ],
)
def test_source_edit_admits_configuration_policy_and_workflow_in_one_remote_command(
    selection: dict[str, object], operation: str
) -> None:
    from services.knowledge_fs.product_dto import KnowledgeFSSourceImportConfigurationPayload

    facade = FakeSourceFacade()
    import_operation = {
        "import_selected_source_crawl": facade.import_selected_source_crawl,
        "import_source_workflow": facade.import_source_workflow,
    }[operation]
    import_operation.result = source_workflow(id="import-1", source_id="source-1")
    payload = KnowledgeFSAsyncSourceImportPayload.model_validate(
        {
            **selection,
            "syncPolicy": {"enabled": True, "mode": "interval"},
        }
    ).root
    source_update = KnowledgeFSSourceImportConfigurationPayload(
        expectedVersion=3,
        name="New source title",
        providerParameters={"limit": 20},
    )
    with patch("tasks.knowledge_fs_source_import_tasks.finalize_source_import.delay") as delay:
        workflow = commit_source_import(
            facade=facade,
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            source_id="source-1",
            payload=payload,
            idempotency_key="source-edit:source-1:3",
            source_update=source_update,
        )
    assert workflow.id == "import-1"
    sent_command = import_operation.last.kwargs["payload"]
    assert isinstance(sent_command, KnowledgeFSCrawlImportPayload | KnowledgeFSSourceWorkflowImportPayload)
    sent = sent_command.model_dump(by_alias=True, exclude_none=True)
    assert sent["sourceUpdate"] == {
        "expectedVersion": 3,
        "name": "New source title",
        "providerParameters": {"limit": 20},
    }
    assert sent["desiredSyncPolicy"] == {"enabled": True, "mode": "interval"}
    assert facade.get_source.calls == []
    assert facade.update_source.calls == []
    delay.assert_called_once()
