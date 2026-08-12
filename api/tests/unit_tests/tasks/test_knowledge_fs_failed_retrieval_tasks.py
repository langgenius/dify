from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from celery.exceptions import Retry

from services.knowledge_fs.app_admission_service import KnowledgeFSAppAdmissionError
from services.knowledge_fs.product_remote import KnowledgeFSProductRequestRejectedError
from tasks import knowledge_fs_failed_retrieval_tasks as task_module

EVENT_ID = "019fac9f-bfb0-75ee-9af5-252ebafbac1e"


def _task_kwargs() -> dict[str, str]:
    return {
        "event_id": EVENT_ID,
        "tenant_id": "tenant-1",
        "app_id": "app-1",
        "control_space_id": "control-1",
        "query": "missing answer",
        "mode": "fast",
        "retrieval_trace_id": "retrieval-trace-1",
    }


def _install_failing_capability(monkeypatch: pytest.MonkeyPatch, error: Exception) -> MagicMock:
    capability = MagicMock()
    capability.capture_workflow_failed_retrieval.side_effect = error
    monkeypatch.setattr(
        task_module,
        "get_knowledge_fs_runtime",
        lambda _session_maker: SimpleNamespace(app_capabilities=capability),
    )
    monkeypatch.setattr(task_module.session_factory, "get_session_maker", lambda: object())
    return capability


def _run_task_with_retries(retries: int) -> None:
    task = task_module.capture_workflow_failed_retrieval_task
    task.push_request(retries=retries)
    try:
        task.run(**_task_kwargs())
    finally:
        task.pop_request()


def test_failed_retrieval_task_runs_on_dataset_queue_and_reauthorizes_app(
    monkeypatch,
) -> None:
    capability = MagicMock()
    capability.capture_workflow_failed_retrieval.return_value = SimpleNamespace(
        failed_query_id="failed-query-1",
        verdict="retrieval-miss",
        bad_case_id="bad-case-1",
    )
    monkeypatch.setattr(
        task_module,
        "get_knowledge_fs_runtime",
        lambda _session_maker: SimpleNamespace(app_capabilities=capability),
    )
    monkeypatch.setattr(task_module.session_factory, "get_session_maker", lambda: object())

    task_module.capture_workflow_failed_retrieval_task.run(**_task_kwargs())

    assert task_module.capture_workflow_failed_retrieval_task.queue == "dataset"
    call = capability.capture_workflow_failed_retrieval.call_args.kwargs
    assert call["tenant_id"] == "tenant-1"
    assert call["app_id"] == "app-1"
    assert call["resource"].control_space_id == "control-1"
    assert str(call["payload"].event_id) == EVENT_ID
    assert call["payload"].query == "missing answer"
    assert call["payload"].retrieval_trace_id == "retrieval-trace-1"


def test_enqueue_is_idempotency_aware_and_never_propagates_broker_failure(monkeypatch) -> None:
    delay = MagicMock()
    monkeypatch.setattr(task_module.capture_workflow_failed_retrieval_task, "delay", delay)

    task_module.enqueue_workflow_failed_retrieval_capture(**_task_kwargs())

    delay.assert_called_once_with(**_task_kwargs())

    delay.side_effect = RuntimeError("broker unavailable")
    task_module.enqueue_workflow_failed_retrieval_capture(**_task_kwargs())


def test_terminal_admission_rejection_is_swallowed(monkeypatch) -> None:
    capability = MagicMock()
    capability.capture_workflow_failed_retrieval.side_effect = KnowledgeFSAppAdmissionError("not admitted")
    monkeypatch.setattr(
        task_module,
        "get_knowledge_fs_runtime",
        lambda _session_maker: SimpleNamespace(app_capabilities=capability),
    )
    monkeypatch.setattr(task_module.session_factory, "get_session_maker", lambda: object())

    task_module.capture_workflow_failed_retrieval_task.run(**_task_kwargs())

    capability.capture_workflow_failed_retrieval.assert_called_once()


def test_rate_limit_rejection_retries_with_initial_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    error = KnowledgeFSProductRequestRejectedError(status_code=429)
    capability = _install_failing_capability(monkeypatch, error)
    retry = MagicMock(side_effect=Retry())
    monkeypatch.setattr(task_module.capture_workflow_failed_retrieval_task, "retry", retry)

    with pytest.raises(Retry):
        _run_task_with_retries(0)

    capability.capture_workflow_failed_retrieval.assert_called_once()
    retry.assert_called_once_with(exc=error, countdown=30)


def test_transient_failure_retries_with_exponential_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    error = RuntimeError("KnowledgeFS temporarily unavailable")
    capability = _install_failing_capability(monkeypatch, error)
    retry = MagicMock(side_effect=Retry())
    monkeypatch.setattr(task_module.capture_workflow_failed_retrieval_task, "retry", retry)

    with pytest.raises(Retry):
        _run_task_with_retries(1)

    capability.capture_workflow_failed_retrieval.assert_called_once()
    retry.assert_called_once_with(exc=error, countdown=60)


def test_retry_budget_exhaustion_raises_original_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    error = RuntimeError("KnowledgeFS remained unavailable")
    capability = _install_failing_capability(monkeypatch, error)
    retry = MagicMock()
    monkeypatch.setattr(task_module.capture_workflow_failed_retrieval_task, "retry", retry)

    with pytest.raises(RuntimeError, match="KnowledgeFS remained unavailable") as exc_info:
        _run_task_with_retries(3)

    assert exc_info.value is error
    capability.capture_workflow_failed_retrieval.assert_called_once()
    retry.assert_not_called()
