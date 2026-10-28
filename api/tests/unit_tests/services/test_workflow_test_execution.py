import json
from dataclasses import replace
from types import SimpleNamespace

import pytest

from extensions import ext_application_services
from models.account import Account
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowType
from services.workflow_test_credentials import TestCredentialDraftChangedError as DraftChanged
from services.workflow_test_execution import prepare_workflow_test_execution
from tests.helpers.workflow_test_credentials import SCOPE, BuilderCredentialHarness, tool_node


@pytest.fixture
def execution(monkeypatch: pytest.MonkeyPatch) -> tuple[App, Account, Workflow, BuilderCredentialHarness]:
    graph = {"nodes": [tool_node("a")]}
    app = App(id=SCOPE.app_id, tenant_id=SCOPE.tenant_id, name="Test", mode=AppMode.WORKFLOW)
    user = Account(name="Builder", email="builder@example.com")
    user.id = SCOPE.account_id
    workflow = Workflow(
        tenant_id=SCOPE.tenant_id,
        app_id=SCOPE.app_id,
        type=WorkflowType.WORKFLOW,
        version="draft",
        graph=json.dumps(graph),
        features="{}",
        created_by=user.id,
    )
    harness = BuilderCredentialHarness(graph)
    harness.draft = replace(harness.draft, hash=workflow.unique_hash)
    monkeypatch.setattr(
        ext_application_services,
        "application_services",
        lambda: SimpleNamespace(workflow_test_credentials=harness.service),
    )
    return app, user, workflow, harness


def test_worker_rechecks_draft_hash_without_serializing_credentials(
    execution: tuple[App, Account, Workflow, BuilderCredentialHarness],
) -> None:
    app, user, workflow, harness = execution
    args = prepare_workflow_test_execution(
        app=app, user=user, workflow=workflow, args={"draft_hash": workflow.unique_hash}, node_id=None
    )
    assert "secret" not in json.dumps(args)
    assert "credential" not in json.dumps(args)
    assert harness.calls == ["credential"]
    workflow.graph = json.dumps({"nodes": [tool_node("a", "replacement")]})
    with pytest.raises(DraftChanged):
        prepare_workflow_test_execution(app=app, user=user, workflow=workflow, args=args, node_id=None)
    assert harness.calls == ["credential"]


def test_test_execution_does_not_accept_a_published_or_cross_app_workflow(
    execution: tuple[App, Account, Workflow, BuilderCredentialHarness],
) -> None:
    app, user, workflow, _ = execution
    for field, value in [("version", "published"), ("app_id", "other"), ("tenant_id", "other")]:
        original = getattr(workflow, field)
        setattr(workflow, field, value)
        with pytest.raises(DraftChanged):
            prepare_workflow_test_execution(
                app=app, user=user, workflow=workflow, args={"draft_hash": workflow.unique_hash}, node_id=None
            )
        setattr(workflow, field, original)
