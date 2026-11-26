import json
from types import SimpleNamespace

import pytest

from extensions import ext_application_services
from models.account import Account
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowType
from services.workflow_test_credentials import TestCredentialError as CredentialError
from services.workflow_test_execution import require_workflow_test_credentials
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
        _features="{}",
        created_by=user.id,
    )
    harness = BuilderCredentialHarness(graph)
    monkeypatch.setattr(
        ext_application_services,
        "application_services",
        lambda: SimpleNamespace(workflow_test_credentials=harness.service),
    )
    return app, user, workflow, harness


def test_worker_checks_its_loaded_graph_without_a_client_version(
    execution: tuple[App, Account, Workflow, BuilderCredentialHarness],
) -> None:
    app, user, workflow, harness = execution
    assert require_workflow_test_credentials(app=app, user=user, workflow=workflow, node_id=None) is None
    assert harness.calls == ["credential"]
    workflow.graph = json.dumps({"nodes": [tool_node("a", "replacement")]})
    require_workflow_test_credentials(app=app, user=user, workflow=workflow, node_id=None)
    assert harness.calls == ["credential", "replacement"]


@pytest.mark.parametrize(
    ("version", "app_id", "tenant_id"),
    [
        ("published", SCOPE.app_id, SCOPE.tenant_id),
        ("draft", "other", SCOPE.tenant_id),
        ("draft", SCOPE.app_id, "other"),
    ],
)
def test_test_execution_does_not_accept_a_published_or_cross_app_workflow(
    execution: tuple[App, Account, Workflow, BuilderCredentialHarness],
    version: str,
    app_id: str,
    tenant_id: str,
) -> None:
    app, user, workflow, _ = execution
    workflow.version = version
    workflow.app_id = app_id
    workflow.tenant_id = tenant_id
    with pytest.raises(CredentialError):
        require_workflow_test_credentials(app=app, user=user, workflow=workflow, node_id=None)
