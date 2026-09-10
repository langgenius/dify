from unittest.mock import Mock
from uuid import uuid4

import pytest
from celery.exceptions import Retry
from dify_agent.protocol.knowledge_fs import KnowledgeFsError

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
