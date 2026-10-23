from typing import Literal, Never
from unittest.mock import patch

import pytest
from celery.exceptions import Retry

from services.knowledge_fs.product_dto import (
    KnowledgeFSSourceResponse,
    KnowledgeFSSourceSyncPolicyPayload,
    KnowledgeFSSourceUpdatePayload,
    KnowledgeFSSourceWorkflowResponse,
)
from services.knowledge_fs.product_remote import (
    KnowledgeFSProductRequestRejectedError,
    KnowledgeFSProductResourceNotFoundError,
)
from tasks import knowledge_fs_source_import_tasks as task_module
from tasks.knowledge_fs_source_import_tasks import (
    KnowledgeFSSourceImportNotReadyError,
    finalize_source_import_once,
)
from tests.unit_tests.tasks.knowledge_fs_task_fakes import (
    FacadeRuntime,
    RecordingKnowledgeFSFacade,
    RecordingRetry,
    json_object,
    source_response,
    source_workflow_response,
)


def _source(*, status: str = "syncing") -> KnowledgeFSSourceResponse:
    return source_response(
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


def _completed_workflow() -> KnowledgeFSSourceWorkflowResponse:
    return source_workflow_response(workflow_id="import-1", state="completed")


def _facade(workflow: KnowledgeFSSourceWorkflowResponse) -> RecordingKnowledgeFSFacade:
    facade = RecordingKnowledgeFSFacade()
    facade.script("get_source_workflow", workflow)
    facade.script("get_source_sync_policy", KnowledgeFSProductResourceNotFoundError("missing"))
    facade.script("update_source_sync_policy", None)
    return facade


def _run(facade: RecordingKnowledgeFSFacade) -> str:
    with patch(
        "tasks.knowledge_fs_source_import_tasks.get_knowledge_fs_runtime",
        return_value=FacadeRuntime(facade),
    ):
        return finalize_source_import_once(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            source_id="source-1",
            workflow_id="import-1",
        )


def _raise(error: Exception) -> Never:
    raise error


def test_finalize_source_import_waits_for_terminal_workflow() -> None:
    facade = _facade(source_workflow_response(workflow_id="import-1", state="importing"))

    with pytest.raises(KnowledgeFSSourceImportNotReadyError):
        _run(facade)

    assert facade.call_count("get_source") == 0


def test_finalize_source_import_activates_source_then_applies_policy_for_new_version() -> None:
    facade = _facade(_completed_workflow())
    facade.script("get_source", _source())
    facade.script(
        "update_source",
        source_response(
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
        ),
    )

    assert _run(facade) == "import-1"

    policy = facade.payload("update_source_sync_policy", KnowledgeFSSourceSyncPolicyPayload)
    assert policy.enabled is False
    assert policy.mode == "manual"
    assert policy.expected_revision == 0
    assert policy.expected_source_version == 5
    update = facade.payload("update_source", KnowledgeFSSourceUpdatePayload)
    update_metadata = json_object(update.metadata)
    assert update.status == "active"
    assert "parameters" not in update_metadata
    assert update_metadata["pendingImport"] is None
    assert json_object(update_metadata["lastImport"])["state"] == "completed"


def test_finalize_source_import_retries_policy_after_source_activation() -> None:
    facade = _facade(_completed_workflow())
    facade.script(
        "get_source",
        source_response(
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
        ),
    )

    assert _run(facade) == "import-1"

    assert facade.call_count("update_source") == 0
    policy = facade.payload("update_source_sync_policy", KnowledgeFSSourceSyncPolicyPayload)
    assert policy.expected_source_version == 5


def test_finalize_source_import_recovers_a_stale_failed_marker_after_workflow_completion() -> None:
    facade = _facade(_completed_workflow())
    facade.script(
        "get_source",
        source_response(
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
        ),
    )
    facade.script(
        "update_source",
        source_response(
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
        ),
    )

    assert _run(facade) == "import-1"

    update = facade.payload("update_source", KnowledgeFSSourceUpdatePayload)

    update_metadata = json_object(update.metadata)
    assert update.status == "active"
    assert json_object(update_metadata["lastImport"])["state"] == "completed"
    assert update_metadata["pendingImport"] is None
    policy = facade.payload("update_source_sync_policy", KnowledgeFSSourceSyncPolicyPayload)
    assert policy.expected_source_version == 6


def test_finalize_source_import_persists_failure_on_visible_source() -> None:
    facade = _facade(
        source_workflow_response(
            workflow_id="import-1",
            state="failed",
            failure_message="provider failed",
            last_error_code="PROVIDER_FAILED",
        )
    )
    facade.script("get_source", _source())
    facade.script("update_source", _source(status="error"))

    assert _run(facade) == "import-1"

    update = facade.payload("update_source", KnowledgeFSSourceUpdatePayload)

    update_metadata = json_object(update.metadata)
    assert update.status == "error"
    assert "parameters" not in update_metadata
    assert update_metadata["lastImport"] == {
        "errorCode": "PROVIDER_FAILED",
        "errorMessage": "provider failed",
        "kind": "crawl-preview-selection",
        "previewWorkflowId": "preview-1",
        "state": "failed",
        "syncPolicy": {"enabled": False, "mode": "manual"},
        "workflowId": "import-1",
    }
    assert update_metadata["pendingImport"] is None
    assert facade.call_count("update_source_sync_policy") == 0


def test_finalize_website_source_import_waits_for_policy_write_fence() -> None:
    facade = _facade(_completed_workflow())
    facade.script(
        "get_source",
        source_response(
            metadata={
                "lastImport": {
                    "kind": "website-crawl-import",
                    "state": "completed",
                    "syncPolicy": {"enabled": True, "mode": "interval"},
                    "workflowId": "import-1",
                },
                "preview": False,
            },
            status="active",
            version=5,
        ),
    )
    facade.script("update_source_sync_policy", KnowledgeFSProductRequestRejectedError(status_code=400))

    with pytest.raises(KnowledgeFSSourceImportNotReadyError):
        _run(facade)


@pytest.mark.parametrize("import_kind", ["online-document-import", "online-drive-import"])
def test_finalize_non_website_source_import_does_not_reclassify_a_bad_request(
    import_kind: str,
) -> None:
    facade = _facade(_completed_workflow())
    facade.script(
        "get_source",
        source_response(
            metadata={
                "lastImport": {
                    "kind": import_kind,
                    "state": "completed",
                    "syncPolicy": {"enabled": True, "mode": "interval"},
                    "workflowId": "import-1",
                },
                "preview": False,
            },
            status="active",
            version=5,
        ),
    )
    rejection = KnowledgeFSProductRequestRejectedError(status_code=400)
    facade.script("update_source_sync_policy", rejection)

    with pytest.raises(KnowledgeFSProductRequestRejectedError) as raised:
        _run(facade)

    assert raised.value is rejection


def test_finalize_source_import_retries_a_source_revision_conflict(monkeypatch: pytest.MonkeyPatch) -> None:
    error = KnowledgeFSProductRequestRejectedError(status_code=409)
    monkeypatch.setattr(task_module, "finalize_source_import_once", lambda **_: _raise(error))
    retry = RecordingRetry()
    monkeypatch.setattr(task_module.finalize_source_import, "retry", retry)

    with pytest.raises(Retry):
        task_module.finalize_source_import.run(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            source_id="source-1",
            workflow_id="import-1",
        )

    assert retry.calls == [{"exc": error}]


@pytest.mark.parametrize("status_code", [400, 422])
def test_finalize_source_import_does_not_retry_a_permanent_rejection(
    monkeypatch: pytest.MonkeyPatch, status_code: Literal[400, 422]
) -> None:
    error = KnowledgeFSProductRequestRejectedError(status_code=status_code)
    monkeypatch.setattr(task_module, "finalize_source_import_once", lambda **_: _raise(error))
    retry = RecordingRetry()
    monkeypatch.setattr(task_module.finalize_source_import, "retry", retry)

    with pytest.raises(KnowledgeFSProductRequestRejectedError) as raised:
        task_module.finalize_source_import.run(
            tenant_id="tenant-1",
            account_id="account-1",
            control_space_id="control-1",
            source_id="source-1",
            workflow_id="import-1",
        )

    assert raised.value is error
    assert retry.calls == []
