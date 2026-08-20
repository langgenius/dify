from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from services.knowledge_fs.product_remote import KnowledgeFSProductResourceNotFoundError
from tasks.knowledge_fs_source_import_tasks import (
    KnowledgeFSSourceImportNotReadyError,
    finalize_source_import_once,
)


def _source(*, status: str = "syncing") -> SimpleNamespace:
    return SimpleNamespace(
        id="source-1",
        metadata={
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


def test_finalize_source_import_applies_policy_then_activates_source() -> None:
    facade = MagicMock()
    facade.get_source_workflow.return_value = SimpleNamespace(state="completed")
    facade.get_source.return_value = _source()
    facade.get_source_sync_policy.side_effect = KnowledgeFSProductResourceNotFoundError("missing")

    assert _run(facade) == "import-1"

    policy = facade.update_source_sync_policy.call_args.kwargs["payload"]
    assert policy.enabled is False
    assert policy.mode == "manual"
    assert policy.expected_revision == 0
    assert policy.expected_source_version == 4
    update = facade.update_source.call_args.kwargs["payload"]
    assert update.status == "active"
    assert "pendingImport" not in update.metadata


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
    assert update.metadata["lastImport"] == {
        "errorCode": "PROVIDER_FAILED",
        "errorMessage": "provider failed",
        "kind": "crawl-preview-selection",
        "previewWorkflowId": "preview-1",
        "state": "failed",
        "syncPolicy": {"enabled": False, "mode": "manual"},
        "workflowId": "import-1",
    }
    facade.update_source_sync_policy.assert_not_called()
