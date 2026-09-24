import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import MagicMock

import pytest

from services.retention.workflow_run import archive_download_adapters
from services.retention.workflow_run.archive_download_adapters import (
    dispatch_workflow_run_archive_download_task,
    sign_workflow_run_archive_download_url,
)
from services.retention.workflow_run.archive_download_task import (
    WorkflowRunArchiveDownloadTask,
    build_pending_archive_download_task,
)


def _task(*, celery_task_id: str | None = "celery-task-1") -> WorkflowRunArchiveDownloadTask:
    return build_pending_archive_download_task(
        tenant_id="tenant-1",
        requested_by="account-1",
        year=2025,
        month=3,
        bundle_ids=["bundle-1"],
        bundle_refs=[("00-of-01", "bundle-1")],
        archive_bytes=1024,
        download_id="download-1",
    ).model_copy(update={"celery_task_id": celery_task_id})


def _patch_archive_download_task(monkeypatch: pytest.MonkeyPatch, *, apply_async: MagicMock) -> None:
    task_module = ModuleType("tasks.workflow_run_archive_download_tasks")
    task_module.__dict__["prepare_workflow_run_archive_download_task"] = SimpleNamespace(apply_async=apply_async)
    monkeypatch.setitem(sys.modules, task_module.__name__, task_module)


def test_dispatch_workflow_run_archive_download_task_enqueues_claimed_task(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    apply_async = MagicMock()
    _patch_archive_download_task(monkeypatch, apply_async=apply_async)

    result = dispatch_workflow_run_archive_download_task(_task())

    assert result is None
    apply_async.assert_called_once_with(
        args=("tenant-1", "download-1"),
        task_id="celery-task-1",
    )


def test_dispatch_workflow_run_archive_download_task_requires_claim_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    apply_async = MagicMock()
    _patch_archive_download_task(monkeypatch, apply_async=apply_async)

    with pytest.raises(ValueError, match="celery_task_id is required before dispatch"):
        dispatch_workflow_run_archive_download_task(_task(celery_task_id=None))

    apply_async.assert_not_called()


def test_dispatch_workflow_run_archive_download_task_propagates_enqueue_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    failure = RuntimeError("broker unavailable")
    apply_async = MagicMock(side_effect=failure)
    _patch_archive_download_task(monkeypatch, apply_async=apply_async)

    with pytest.raises(RuntimeError) as raised:
        dispatch_workflow_run_archive_download_task(_task())

    assert raised.value is failure


def test_sign_workflow_run_archive_download_url_resolves_export_storage_lazily(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    storage = MagicMock()
    storage.generate_presigned_url.return_value = "https://download.example/archive.zip"
    get_export_storage = MagicMock(return_value=storage)
    monkeypatch.setattr(archive_download_adapters, "get_export_storage", get_export_storage)

    assert get_export_storage.call_count == 0

    result = sign_workflow_run_archive_download_url(
        "downloads/archive.zip",
        expires_in=900,
        filename="workflow-run-logs-2025-03.zip",
    )

    assert result == "https://download.example/archive.zip"
    get_export_storage.assert_called_once_with()
    storage.generate_presigned_url.assert_called_once_with(
        "downloads/archive.zip",
        expires_in=900,
        filename="workflow-run-logs-2025-03.zip",
        content_type="application/zip",
    )
