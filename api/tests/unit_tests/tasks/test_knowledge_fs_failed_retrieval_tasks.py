from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

import pytest
from celery.app.task import Context
from celery.exceptions import Retry
from typing_extensions import TypedDict

from core.knowledge_fs.resource import KnowledgeResourceRef
from services.knowledge_fs.app_admission_service import KnowledgeFSAppAdmissionError
from services.knowledge_fs.product_dto import (
    KnowledgeFSWorkflowFailedRetrievalCapturePayload,
    KnowledgeFSWorkflowFailedRetrievalCaptureResponse,
)
from services.knowledge_fs.product_remote import KnowledgeFSProductRequestRejectedError
from tasks import knowledge_fs_failed_retrieval_tasks as task_module
from tests.unit_tests.tasks.knowledge_fs_task_fakes import RecordingRetry
from tests.unit_tests.tasks.task_options import task_options

EVENT_ID = "019fac9f-bfb0-75ee-9af5-252ebafbac1e"


class FailedRetrievalTaskArguments(TypedDict, closed=True):
    event_id: str
    tenant_id: str
    app_id: str
    control_space_id: str
    query: str
    mode: Literal["fast", "deep", "research"]
    retrieval_trace_id: str


def _task_kwargs() -> FailedRetrievalTaskArguments:
    return {
        "event_id": EVENT_ID,
        "tenant_id": "tenant-1",
        "app_id": "app-1",
        "control_space_id": "control-1",
        "query": "missing answer",
        "mode": "fast",
        "retrieval_trace_id": "retrieval-trace-1",
    }


@dataclass(frozen=True)
class _CaptureCall:
    tenant_id: str
    app_id: str
    resource: KnowledgeResourceRef
    payload: KnowledgeFSWorkflowFailedRetrievalCapturePayload


@dataclass
class _AppCapabilities:
    outcome: KnowledgeFSWorkflowFailedRetrievalCaptureResponse | Exception
    calls: list[_CaptureCall] = field(default_factory=list)

    def capture_workflow_failed_retrieval(
        self,
        *,
        tenant_id: str,
        app_id: str,
        resource: KnowledgeResourceRef,
        payload: KnowledgeFSWorkflowFailedRetrievalCapturePayload,
    ) -> KnowledgeFSWorkflowFailedRetrievalCaptureResponse:
        self.calls.append(_CaptureCall(tenant_id=tenant_id, app_id=app_id, resource=resource, payload=payload))
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


@dataclass(frozen=True)
class _Runtime:
    app_capabilities: _AppCapabilities


def _install_capability(
    monkeypatch: pytest.MonkeyPatch, outcome: KnowledgeFSWorkflowFailedRetrievalCaptureResponse | Exception
) -> _AppCapabilities:
    capability = _AppCapabilities(outcome)
    monkeypatch.setattr(task_module, "get_knowledge_fs_runtime", lambda _session_maker: _Runtime(capability))
    monkeypatch.setattr(task_module.session_factory, "get_session_maker", lambda: object())
    return capability


def _run_task_with_retries(retries: int) -> None:
    task = task_module.capture_workflow_failed_retrieval_task
    task.request_stack.push(Context(retries=retries))
    try:
        task.run(**_task_kwargs())
    finally:
        task.pop_request()


def test_failed_retrieval_task_runs_on_dataset_queue_and_reauthorizes_app(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    capability = _install_capability(
        monkeypatch,
        KnowledgeFSWorkflowFailedRetrievalCaptureResponse.model_construct(
            failed_query_id="failed-query-1",
            verdict="retrieval-miss",
            bad_case_id="bad-case-1",
        ),
    )

    task_module.capture_workflow_failed_retrieval_task.run(**_task_kwargs())

    assert task_options(task_module.capture_workflow_failed_retrieval_task)["queue"] == "dataset"
    assert len(capability.calls) == 1
    call = capability.calls[0]
    assert call.tenant_id == "tenant-1"
    assert call.app_id == "app-1"
    assert call.resource.control_space_id == "control-1"
    assert str(call.payload.event_id) == EVENT_ID
    assert call.payload.query == "missing answer"
    assert call.payload.retrieval_trace_id == "retrieval-trace-1"


def test_enqueue_is_idempotency_aware_and_never_propagates_broker_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    delayed: list[dict[str, object]] = []
    monkeypatch.setattr(
        task_module.capture_workflow_failed_retrieval_task, "delay", lambda **kwargs: delayed.append(kwargs)
    )

    task_module.enqueue_workflow_failed_retrieval_capture(**_task_kwargs())

    assert delayed == [_task_kwargs()]

    def unavailable_broker(**kwargs: object) -> None:
        delayed.append(kwargs)
        raise RuntimeError("broker unavailable")

    monkeypatch.setattr(task_module.capture_workflow_failed_retrieval_task, "delay", unavailable_broker)
    task_module.enqueue_workflow_failed_retrieval_capture(**_task_kwargs())
    assert len(delayed) == 2


def test_terminal_admission_rejection_is_swallowed(monkeypatch: pytest.MonkeyPatch) -> None:
    capability = _install_capability(monkeypatch, KnowledgeFSAppAdmissionError("not admitted"))

    task_module.capture_workflow_failed_retrieval_task.run(**_task_kwargs())

    assert len(capability.calls) == 1


def test_rate_limit_rejection_retries_with_initial_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    error = KnowledgeFSProductRequestRejectedError(status_code=429)
    capability = _install_capability(monkeypatch, error)
    retry = RecordingRetry()
    monkeypatch.setattr(task_module.capture_workflow_failed_retrieval_task, "retry", retry)

    with pytest.raises(Retry):
        _run_task_with_retries(0)

    assert len(capability.calls) == 1
    assert retry.calls == [{"exc": error, "countdown": 30}]


def test_transient_failure_retries_with_exponential_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    error = RuntimeError("KnowledgeFS temporarily unavailable")
    capability = _install_capability(monkeypatch, error)
    retry = RecordingRetry()
    monkeypatch.setattr(task_module.capture_workflow_failed_retrieval_task, "retry", retry)

    with pytest.raises(Retry):
        _run_task_with_retries(1)

    assert len(capability.calls) == 1
    assert retry.calls == [{"exc": error, "countdown": 60}]


def test_retry_budget_exhaustion_raises_original_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    error = RuntimeError("KnowledgeFS remained unavailable")
    capability = _install_capability(monkeypatch, error)
    retry = RecordingRetry()
    monkeypatch.setattr(task_module.capture_workflow_failed_retrieval_task, "retry", retry)

    with pytest.raises(RuntimeError, match="KnowledgeFS remained unavailable") as exc_info:
        _run_task_with_retries(3)

    assert exc_info.value is error
    assert len(capability.calls) == 1
    assert retry.calls == []
