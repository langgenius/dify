import sys
from collections.abc import Callable
from types import ModuleType

import pytest

from libs.archive_storage import ArchiveStorage
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


def _patch_archive_download_task(
    monkeypatch: pytest.MonkeyPatch,
    *,
    apply_async: Callable[..., None],
) -> None:
    task_module = ModuleType("tasks.workflow_run_archive_download_tasks")
    celery_task = ModuleType("prepare_workflow_run_archive_download_task")
    celery_task.__dict__["apply_async"] = apply_async
    task_module.__dict__["prepare_workflow_run_archive_download_task"] = celery_task
    monkeypatch.setitem(sys.modules, task_module.__name__, task_module)


def test_dispatch_workflow_run_archive_download_task_enqueues_claimed_task(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[tuple[str, str], str]] = []

    def apply_async(*, args: tuple[str, str], task_id: str) -> None:
        calls.append((args, task_id))

    _patch_archive_download_task(monkeypatch, apply_async=apply_async)

    result = dispatch_workflow_run_archive_download_task(_task())

    assert result is None
    assert calls == [(("tenant-1", "download-1"), "celery-task-1")]


def test_dispatch_workflow_run_archive_download_task_requires_claim_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[tuple[str, str], str]] = []

    def apply_async(*, args: tuple[str, str], task_id: str) -> None:
        calls.append((args, task_id))

    _patch_archive_download_task(monkeypatch, apply_async=apply_async)

    with pytest.raises(ValueError, match="celery_task_id is required before dispatch"):
        dispatch_workflow_run_archive_download_task(_task(celery_task_id=None))

    assert calls == []


def test_dispatch_workflow_run_archive_download_task_propagates_enqueue_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    failure = RuntimeError("broker unavailable")

    def apply_async(*, args: tuple[str, str], task_id: str) -> None:
        del args, task_id
        raise failure

    _patch_archive_download_task(monkeypatch, apply_async=apply_async)

    with pytest.raises(RuntimeError) as raised:
        dispatch_workflow_run_archive_download_task(_task())

    assert raised.value is failure


def test_sign_workflow_run_archive_download_url_resolves_export_storage_lazily(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    storage = object.__new__(ArchiveStorage)
    get_export_storage_calls: list[None] = []
    generate_presigned_url_calls: list[tuple[str, int, str | None, str | None]] = []

    def generate_presigned_url(
        key: str,
        expires_in: int = 3600,
        *,
        filename: str | None = None,
        content_type: str | None = None,
    ) -> str:
        generate_presigned_url_calls.append((key, expires_in, filename, content_type))
        return "https://download.example/archive.zip"

    def get_export_storage() -> ArchiveStorage:
        get_export_storage_calls.append(None)
        return storage

    monkeypatch.setattr(storage, "generate_presigned_url", generate_presigned_url)
    monkeypatch.setattr(archive_download_adapters, "get_export_storage", get_export_storage)

    assert get_export_storage_calls == []

    result = sign_workflow_run_archive_download_url(
        "downloads/archive.zip",
        expires_in=900,
        filename="workflow-run-logs-2025-03.zip",
    )

    assert result == "https://download.example/archive.zip"
    assert get_export_storage_calls == [None]
    assert generate_presigned_url_calls == [
        ("downloads/archive.zip", 900, "workflow-run-logs-2025-03.zip", "application/zip")
    ]
