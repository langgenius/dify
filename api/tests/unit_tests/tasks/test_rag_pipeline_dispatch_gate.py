from __future__ import annotations

import importlib
from types import SimpleNamespace
from typing import Protocol
from unittest.mock import Mock, patch

import pytest

from core.rag.pipeline.queue import TenantTaskDispatchClaimOutcome
from tasks.rag_pipeline.priority_rag_pipeline_run_task import priority_rag_pipeline_run_task
from tasks.rag_pipeline.rag_pipeline_run_task import rag_pipeline_run_task
from tasks.rag_pipeline.rag_pipeline_task_support import RAG_PIPELINE_DISPATCH_TOKEN_HEADER


class _RagPipelineTask(Protocol):
    acks_late: bool
    reject_on_worker_lost: bool
    max_retries: int | None

    def run(self, source_batch_id: str, tenant_id: str, dispatch_token: str | None = None) -> object: ...


@pytest.mark.parametrize(
    ("task", "module_path"),
    [
        (rag_pipeline_run_task, "tasks.rag_pipeline.rag_pipeline_run_task"),
        (
            priority_rag_pipeline_run_task,
            "tasks.rag_pipeline.priority_rag_pipeline_run_task",
        ),
    ],
    ids=["regular", "priority"],
)
def test_completed_dispatch_is_skipped_before_loading_source_file(task: _RagPipelineTask, module_path: str) -> None:
    with (
        patch(f"{module_path}.RagPipelineDispatchLease.acquire") as acquire,
        patch(f"{module_path}.FileService") as file_service,
    ):
        acquire.return_value = (TenantTaskDispatchClaimOutcome.DONE, None)

        result = task.run("source-batch", "tenant-1", dispatch_token="dispatch-1")

    assert result == {"status": "already_completed", "dispatch_token": "dispatch-1"}
    file_service.assert_not_called()


@pytest.mark.parametrize(
    ("task", "module_path"),
    [
        (rag_pipeline_run_task, "tasks.rag_pipeline.rag_pipeline_run_task"),
        (
            priority_rag_pipeline_run_task,
            "tasks.rag_pipeline.priority_rag_pipeline_run_task",
        ),
    ],
    ids=["regular", "priority"],
)
def test_busy_dispatch_retries_without_loading_source_file(task: _RagPipelineTask, module_path: str) -> None:
    retry_error = RuntimeError("retry scheduled")
    with (
        patch(f"{module_path}.RagPipelineDispatchLease.acquire") as acquire,
        patch(f"{module_path}.FileService") as file_service,
        patch.object(task, "retry", side_effect=retry_error) as retry,
    ):
        acquire.return_value = (TenantTaskDispatchClaimOutcome.BUSY, None)

        with pytest.raises(RuntimeError, match="retry scheduled"):
            task.run("source-batch", "tenant-1", dispatch_token="dispatch-1")

    retry.assert_called_once()
    assert retry.call_args.kwargs["countdown"] > 0
    file_service.assert_not_called()


@pytest.mark.parametrize("task", [rag_pipeline_run_task, priority_rag_pipeline_run_task])
def test_rag_pipeline_tasks_use_worker_loss_redelivery(task: _RagPipelineTask) -> None:
    assert task.acks_late is True
    assert task.reject_on_worker_lost is True
    assert task.max_retries is None


def test_dispatch_task_argument_remains_optional_for_old_messages() -> None:
    regular_defaults = rag_pipeline_run_task.run.__defaults__
    priority_defaults = priority_rag_pipeline_run_task.run.__defaults__

    assert regular_defaults is not None
    assert regular_defaults[-1] is None
    assert priority_defaults is not None
    assert priority_defaults[-1] is None


def test_new_receiver_reads_dispatch_token_from_header_without_changing_old_task_kwargs() -> None:
    module_path = "tasks.rag_pipeline.rag_pipeline_run_task"
    rag_pipeline_run_task.push_request(
        id="celery-delivery-1",
        hostname="worker-1",
        headers={RAG_PIPELINE_DISPATCH_TOKEN_HEADER: "header-dispatch-token"},
    )
    try:
        with (
            patch(f"{module_path}.RagPipelineDispatchLease.acquire") as acquire,
            patch(f"{module_path}.FileService") as file_service,
        ):
            acquire.return_value = (TenantTaskDispatchClaimOutcome.DONE, None)

            result = rag_pipeline_run_task.run("source-batch", "tenant-1")
    finally:
        rag_pipeline_run_task.pop_request()

    assert result == {
        "status": "already_completed",
        "dispatch_token": "header-dispatch-token",
    }
    acquire.assert_called_once()
    file_service.assert_not_called()


def test_handoff_release_publishes_token_in_header_with_legacy_task_kwargs(monkeypatch: pytest.MonkeyPatch) -> None:
    regular_module = importlib.import_module("tasks.rag_pipeline.rag_pipeline_run_task")
    priority_module = importlib.import_module("tasks.rag_pipeline.priority_rag_pipeline_run_task")
    monkeypatch.setattr(regular_module, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(regular_module, "sessionmaker", Mock(return_value=Mock()))
    monkeypatch.setattr(regular_module.dify_config, "WORKFLOW_HANDOFF_QUEUE", "workflow-handoff-v2")
    monkeypatch.setattr(
        regular_module,
        "SQLAlchemyRagPipelineHandoffGroupRepository",
        Mock(return_value=Mock()),
    )
    regular_apply_async = Mock()
    priority_apply_async = Mock()
    monkeypatch.setattr(regular_module.rag_pipeline_run_task, "apply_async", regular_apply_async)
    monkeypatch.setattr(priority_module.priority_rag_pipeline_run_task, "apply_async", priority_apply_async)
    service = regular_module._create_handoff_group_service()

    service._regular_enqueue("regular-file", "tenant-1", "regular-token")
    service._priority_enqueue("priority-file", "tenant-1", "priority-token")

    assert regular_apply_async.call_args.kwargs == {
        "kwargs": {
            "rag_pipeline_invoke_entities_file_id": "regular-file",
            "tenant_id": "tenant-1",
        },
        "headers": {RAG_PIPELINE_DISPATCH_TOKEN_HEADER: "regular-token"},
        "queue": "workflow-handoff-v2",
    }
    assert priority_apply_async.call_args.kwargs == {
        "kwargs": {
            "rag_pipeline_invoke_entities_file_id": "priority-file",
            "tenant_id": "tenant-1",
        },
        "headers": {RAG_PIPELINE_DISPATCH_TOKEN_HEADER: "priority-token"},
        "queue": "workflow-handoff-v2",
    }


def test_celery_retry_signature_preserves_dispatch_header() -> None:
    rag_pipeline_run_task.push_request(
        id="celery-delivery-1",
        args=("source-batch", "tenant-1"),
        kwargs={},
        delivery_info={"routing_key": "pipeline", "exchange": ""},
        headers={RAG_PIPELINE_DISPATCH_TOKEN_HEADER: "header-dispatch-token"},
    )
    try:
        retry_signature = rag_pipeline_run_task.signature_from_request(countdown=30)
    finally:
        rag_pipeline_run_task.pop_request()

    assert retry_signature.options["headers"] == {RAG_PIPELINE_DISPATCH_TOKEN_HEADER: "header-dispatch-token"}
