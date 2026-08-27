from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from celery.exceptions import Retry

from services.knowledge_fs.product_remote import (
    KnowledgeFSProductRequestRejectedError,
    KnowledgeFSProductResourceNotFoundError,
)
from tasks import knowledge_fs_source_import_tasks as task_module
from tasks.knowledge_fs_source_import_tasks import (
    KnowledgeFSSourceImportNotReadyError,
    finalize_source_import_once,
)


def _source(*, status: str = "syncing") -> SimpleNamespace:
    return SimpleNamespace(
        id="source-1",
        metadata={
            "parameters": {"limit": 99},
            "preview": False,
            "pendingImport": {
                "kind": "crawl-preview-selection",
                "previewWorkflowId": "preview-1",
                "workflowId": "import-1",
                "syncPolicy": {"enabled": False, "mode": "manual"},
            },
        },
        status=status,
        version=4,
    )


def _run(facade: MagicMock) -> str:
    with patch("tasks.knowledge_fs_source_import_tasks.get_knowledge_fs_runtime") as runtime:
        runtime.return_value.facade = facade
        return finalize_source_import_once(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            source_id="source-1",
            workflow_id="import-1",
        )


def test_finalize_source_import_waits_for_terminal_workflow() -> None:
    facade = MagicMock()
    facade.get_source_workflow.return_value = SimpleNamespace(state="importing")

    with pytest.raises(KnowledgeFSSourceImportNotReadyError):
        _run(facade)

    facade.get_source.assert_not_called()


def test_finalize_source_import_activates_source_then_applies_policy_for_new_version() -> None:
    facade = MagicMock()
    facade.get_source_workflow.return_value = SimpleNamespace(id="import-1", state="completed")
    facade.get_source.return_value = _source()
    facade.update_source.return_value = SimpleNamespace(
        id="source-1",
        metadata={
            "lastImport": {
                "kind": "crawl-preview-selection",
                "previewWorkflowId": "preview-1",
                "state": "completed",
                "syncPolicy": {"enabled": False, "mode": "manual"},
                "workflowId": "import-1",
            },
            "preview": False,
        },
        status="active",
        version=5,
    )
    facade.get_source_sync_policy.side_effect = KnowledgeFSProductResourceNotFoundError("missing")

    assert _run(facade) == "import-1"

    policy = facade.update_source_sync_policy.call_args.kwargs["payload"]
    assert policy.enabled is False
    assert policy.mode == "manual"
    assert policy.expected_revision == 0
    assert policy.expected_source_version == 5
    update = facade.update_source.call_args.kwargs["payload"]
    assert update.status == "active"
    assert "parameters" not in update.metadata
    assert update.metadata["pendingImport"] is None
    assert update.metadata["lastImport"]["state"] == "completed"


def test_finalize_source_import_retries_policy_after_source_activation() -> None:
    facade = MagicMock()
    facade.get_source_workflow.return_value = SimpleNamespace(id="import-1", state="completed")
    facade.get_source.return_value = SimpleNamespace(
        id="source-1",
        metadata={
            "lastImport": {
                "kind": "crawl-preview-selection",
                "previewWorkflowId": "preview-1",
                "state": "completed",
                "syncPolicy": {"enabled": True, "mode": "interval"},
                "workflowId": "import-1",
            },
            "preview": False,
        },
        status="active",
        version=5,
    )
    facade.get_source_sync_policy.side_effect = KnowledgeFSProductResourceNotFoundError("missing")

    assert _run(facade) == "import-1"

    facade.update_source.assert_not_called()
    policy = facade.update_source_sync_policy.call_args.kwargs["payload"]
    assert policy.expected_source_version == 5


def test_finalize_source_import_recovers_a_stale_failed_marker_after_workflow_completion() -> None:
    facade = MagicMock()
    facade.get_source_workflow.return_value = SimpleNamespace(id="import-1", state="completed")
    facade.get_source.return_value = SimpleNamespace(
        id="source-1",
        metadata={
            "lastImport": {
                "errorCode": "SOURCE_OPERATION_FAILED",
                "errorMessage": "provider failed",
                "kind": "crawl-preview-selection",
                "previewWorkflowId": "preview-1",
                "state": "failed",
                "syncPolicy": {"enabled": False, "mode": "manual"},
                "workflowId": "import-1",
            },
            "pendingImport": None,
            "preview": False,
        },
        status="error",
        version=5,
    )
    facade.update_source.return_value = SimpleNamespace(
        id="source-1",
        metadata={
            "lastImport": {
                "kind": "crawl-preview-selection",
                "previewWorkflowId": "preview-1",
                "state": "completed",
                "syncPolicy": {"enabled": False, "mode": "manual"},
                "workflowId": "import-1",
            },
            "pendingImport": None,
            "preview": False,
        },
        status="active",
        version=6,
    )
    facade.get_source_sync_policy.side_effect = KnowledgeFSProductResourceNotFoundError("missing")

    assert _run(facade) == "import-1"

    update = facade.update_source.call_args.kwargs["payload"]
    assert update.status == "active"
    assert update.metadata["lastImport"]["state"] == "completed"
    assert update.metadata["pendingImport"] is None
    policy = facade.update_source_sync_policy.call_args.kwargs["payload"]
    assert policy.expected_source_version == 6


def test_finalize_source_import_persists_failure_on_visible_source() -> None:
    facade = MagicMock()
    facade.get_source_workflow.return_value = SimpleNamespace(
        failure=SimpleNamespace(message="provider failed"),
        id="import-1",
        last_error_code="PROVIDER_FAILED",
        state="failed",
    )
    facade.get_source.return_value = _source()

    assert _run(facade) == "import-1"

    update = facade.update_source.call_args.kwargs["payload"]
    assert update.status == "error"
    assert "parameters" not in update.metadata
    assert update.metadata["lastImport"] == {
        "errorCode": "PROVIDER_FAILED",
        "errorMessage": "provider failed",
        "kind": "crawl-preview-selection",
        "previewWorkflowId": "preview-1",
        "state": "failed",
        "syncPolicy": {"enabled": False, "mode": "manual"},
        "workflowId": "import-1",
    }
    assert update.metadata["pendingImport"] is None
    facade.update_source_sync_policy.assert_not_called()


def test_finalize_source_import_retries_a_source_revision_conflict(monkeypatch: pytest.MonkeyPatch) -> None:
    error = KnowledgeFSProductRequestRejectedError(status_code=409)
    monkeypatch.setattr(task_module, "finalize_source_import_once", MagicMock(side_effect=error))
    retry = MagicMock(side_effect=Retry())
    monkeypatch.setattr(task_module.finalize_source_import, "retry", retry)

    with pytest.raises(Retry):
        task_module.finalize_source_import.run(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            source_id="source-1",
            workflow_id="import-1",
        )

    retry.assert_called_once_with(exc=error)
