from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Literal
from uuid import uuid4

import pytest
from celery.exceptions import Retry
from dify_agent.protocol.knowledge_fs import KnowledgeFsError
from dify_agent.protocol.knowledge_investigation import KnowledgeInvestigationPayload
from flask import Flask

from services.agent.config_assets_store import AgentConfigTargetError, AgentConfigTargetErrorCode
from services.knowledge_fs.product_remote import KnowledgeFSProductRequestRejectedError
from tasks import knowledge_fs_agent_investigation_tasks as module
from tests.helpers.unit.tasks.knowledge_fs_task_fakes import RecordingRetry
from tests.helpers.unit.tasks.task_options import task_options


@dataclass
class _Gateway:
    """Records investigation captures; raises ``error`` when one is configured."""

    error: Exception | None = None
    captures: list[tuple[KnowledgeInvestigationPayload, str]] = field(default_factory=list)

    def capture_investigation(self, report: KnowledgeInvestigationPayload, control_space_id: str) -> None:
        self.captures.append((report, control_space_id))
        if self.error is not None:
            raise self.error


@dataclass(frozen=True)
class _AgentApps:
    knowledge: _Gateway


@dataclass(frozen=True)
class _Services:
    agent_apps: _AgentApps


@pytest.fixture
def gateway() -> Iterator[_Gateway]:
    """Bind the investigation gateway through the Flask extension used by workers."""
    app = Flask(__name__)
    gateway = _Gateway()
    app.extensions["application_services"] = _Services(agent_apps=_AgentApps(knowledge=gateway))
    with app.app_context():
        yield gateway


def report() -> tuple[dict[str, object], str]:
    space = str(uuid4())
    attempts: list[dict[str, object]] = []
    return {
        "investigation_id": str(uuid4()),
        "execution_context": {"tenant_id": "tenant", "agent_mode": "agent_app", "invoke_from": "published"},
        "bindings": [{"id": "docs", "name": "Docs", "control_space_id": space}],
        "query": "refund",
        "status": "completed",
        "attempts": attempts,
    }, space


def test_dataset_worker_reconstructs_report_for_each_delivery(gateway: _Gateway) -> None:
    payload, space = report()
    task = module.capture_agent_knowledge_investigation_task
    task.run(report=payload, control_space_id=space)
    task.run(report=payload, control_space_id=space)
    assert task_options(task)["queue"] == "dataset"
    first, second = gateway.captures
    assert first == second
    assert first[1] == space
    assert str(first[0].investigation_id) == payload["investigation_id"]


def test_revoked_authority_stops_publication_and_transient_failures_retry(
    gateway: _Gateway, monkeypatch: pytest.MonkeyPatch
) -> None:
    gateway.error = KnowledgeFsError("KNOWLEDGE_SCOPE_CHANGED", "revoked", 403)
    payload, space = report()
    task = module.capture_agent_knowledge_investigation_task
    retry = RecordingRetry()
    monkeypatch.setattr(task, "retry", retry)
    task.run(report=payload, control_space_id=space)
    gateway.error = AgentConfigTargetError(AgentConfigTargetErrorCode.VERSION_NOT_FOUND, "missing config")
    task.run(report=payload, control_space_id=space)
    assert retry.calls == []
    gateway.error = OSError("offline")
    with pytest.raises(Retry):
        task.run(report=payload, control_space_id=space)
    assert len(retry.calls) == 1


@pytest.mark.parametrize("status_code", [400, 403, 409, 413, 422])
def test_permanent_remote_rejections_do_not_retry(
    gateway: _Gateway, monkeypatch: pytest.MonkeyPatch, status_code: Literal[400, 403, 409, 413, 422]
) -> None:
    gateway.error = KnowledgeFSProductRequestRejectedError(status_code=status_code)
    task = module.capture_agent_knowledge_investigation_task
    retry = RecordingRetry()
    monkeypatch.setattr(task, "retry", retry)
    payload, space = report()

    task.run(report=payload, control_space_id=space)

    assert len(gateway.captures) == 1
    assert retry.calls == []


@pytest.mark.parametrize(("retries", "countdown"), [(0, 30), (1, 60), (2, 120)])
def test_rate_limited_report_retries_with_backoff(
    gateway: _Gateway, monkeypatch: pytest.MonkeyPatch, retries: int, countdown: int
) -> None:
    error = KnowledgeFSProductRequestRejectedError(status_code=429)
    gateway.error = error
    task = module.capture_agent_knowledge_investigation_task
    retry = RecordingRetry()
    monkeypatch.setattr(task, "retry", retry)
    monkeypatch.setattr(task.request, "retries", retries)
    payload, space = report()

    with pytest.raises(Retry):
        task.run(report=payload, control_space_id=space)

    assert retry.calls == [{"exc": error, "countdown": countdown}]


def test_malformed_queued_report_is_rejected_before_gateway_publication(
    gateway: _Gateway, monkeypatch: pytest.MonkeyPatch
) -> None:
    task = module.capture_agent_knowledge_investigation_task
    retry = RecordingRetry()
    monkeypatch.setattr(task, "retry", retry)

    task.run(report={"investigation_id": "invalid"}, control_space_id=str(uuid4()))

    assert gateway.captures == []
    assert retry.calls == []
