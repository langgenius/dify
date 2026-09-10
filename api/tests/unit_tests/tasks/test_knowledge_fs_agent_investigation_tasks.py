from unittest.mock import Mock
from uuid import uuid4

import pytest
from celery.exceptions import Retry
from dify_agent.protocol.knowledge_fs import KnowledgeFsError

from services.knowledge_fs.product_remote import KnowledgeFSProductRequestRejectedError
from tasks import knowledge_fs_agent_investigation_tasks as module
from tests.unit_tests.tasks.task_options import task_options


def report():
    space = str(uuid4())
    return {
        "investigation_id": str(uuid4()),
        "execution_context": {"tenant_id": "tenant", "agent_mode": "agent_app", "invoke_from": "published"},
        "bindings": [{"id": "docs", "name": "Docs", "control_space_id": space}],
        "query": "refund",
        "status": "completed",
        "attempts": [],
    }, space


def test_dataset_worker_reconstructs_report_for_each_delivery(monkeypatch):
    gateway = Mock()
    monkeypatch.setattr(module, "AgentKnowledgeGateway", lambda: gateway)
    payload, space = report()
    task = module.capture_agent_knowledge_investigation_task
    task.run(report=payload, control_space_id=space)
    task.run(report=payload, control_space_id=space)
    assert task_options(task)["queue"] == "dataset"
    first, second = gateway.capture_investigation.call_args_list
    assert first == second
    assert str(first.args[0].investigation_id) == payload["investigation_id"]


def test_revoked_authority_stops_publication_and_transient_failures_retry(monkeypatch):
    gateway = Mock()
    monkeypatch.setattr(module, "AgentKnowledgeGateway", lambda: gateway)
    payload, space = report()
    task = module.capture_agent_knowledge_investigation_task
    retry = Mock(side_effect=Retry())
    monkeypatch.setattr(task, "retry", retry)
    gateway.capture_investigation.side_effect = KnowledgeFsError("KNOWLEDGE_SCOPE_CHANGED", "revoked", 403)
    task.run(report=payload, control_space_id=space)
    retry.assert_not_called()
    gateway.capture_investigation.side_effect = OSError("offline")
    with pytest.raises(Retry):
        task.run(report=payload, control_space_id=space)
    retry.assert_called_once()


@pytest.mark.parametrize("status_code", [400, 403, 409, 413, 422])
def test_permanent_remote_rejections_do_not_retry(monkeypatch, status_code):
    gateway = Mock()
    gateway.capture_investigation.side_effect = KnowledgeFSProductRequestRejectedError(status_code=status_code)
    monkeypatch.setattr(module, "AgentKnowledgeGateway", lambda: gateway)
    task = module.capture_agent_knowledge_investigation_task
    retry = Mock(side_effect=Retry())
    monkeypatch.setattr(task, "retry", retry)
    payload, space = report()

    task.run(report=payload, control_space_id=space)

    gateway.capture_investigation.assert_called_once()
    retry.assert_not_called()


@pytest.mark.parametrize(("retries", "countdown"), [(0, 30), (1, 60), (2, 120)])
def test_rate_limited_report_retries_with_backoff(monkeypatch, retries, countdown):
    gateway = Mock()
    error = KnowledgeFSProductRequestRejectedError(status_code=429)
    gateway.capture_investigation.side_effect = error
    monkeypatch.setattr(module, "AgentKnowledgeGateway", lambda: gateway)
    task = module.capture_agent_knowledge_investigation_task
    retry = Mock(side_effect=Retry())
    monkeypatch.setattr(task, "retry", retry)
    monkeypatch.setattr(task.request, "retries", retries)
    payload, space = report()

    with pytest.raises(Retry):
        task.run(report=payload, control_space_id=space)

    retry.assert_called_once_with(exc=error, countdown=countdown)


def test_malformed_queued_report_is_rejected_before_gateway_publication(monkeypatch):
    gateway = Mock()
    monkeypatch.setattr(module, "AgentKnowledgeGateway", lambda: gateway)
    task = module.capture_agent_knowledge_investigation_task
    retry = Mock(side_effect=Retry())
    monkeypatch.setattr(task, "retry", retry)

    task.run(report={"investigation_id": "invalid"}, control_space_id=str(uuid4()))

    gateway.capture_investigation.assert_not_called()
    retry.assert_not_called()
