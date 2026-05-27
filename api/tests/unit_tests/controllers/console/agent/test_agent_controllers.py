from types import SimpleNamespace

import pytest

from controllers.console.agent import composer as composer_controller
from controllers.console.agent import roster as roster_controller
from controllers.console.agent.composer import (
    AgentAppComposerApi,
    AgentAppComposerCandidatesApi,
    AgentAppComposerValidateApi,
    WorkflowAgentComposerApi,
    WorkflowAgentComposerCandidatesApi,
    WorkflowAgentComposerImpactApi,
    WorkflowAgentComposerSaveToRosterApi,
    WorkflowAgentComposerValidateApi,
)
from controllers.console.agent.roster import (
    AgentInviteOptionsApi,
    AgentRosterDetailApi,
    AgentRosterListApi,
    AgentRosterVersionDetailApi,
    AgentRosterVersionsApi,
)
from services.entities.agent_entities import ComposerSaveStrategy, ComposerVariant


def _unwrap(method):
    while hasattr(method, "__wrapped__"):
        method = method.__wrapped__
    return method


@pytest.fixture
def account():
    return SimpleNamespace(id="account-1")


@pytest.fixture(autouse=True)
def patch_account_context(monkeypatch, account):
    monkeypatch.setattr(roster_controller, "current_account_with_tenant", lambda: (account, "tenant-1"))
    monkeypatch.setattr(composer_controller, "current_account_with_tenant", lambda: (account, "tenant-1"))


def test_roster_list_get_parses_query_and_calls_service(app, monkeypatch):
    captured = {}

    def list_roster_agents(_self, **kwargs):
        captured.update(kwargs)
        return {"data": [], "page": kwargs["page"], "limit": kwargs["limit"], "total": 0, "has_more": False}

    monkeypatch.setattr(roster_controller.AgentRosterService, "list_roster_agents", list_roster_agents)

    with app.test_request_context("/console/api/agents?page=2&limit=5&keyword=analyst"):
        result = _unwrap(AgentRosterListApi.get)(AgentRosterListApi())

    assert result["page"] == 2
    assert captured == {"tenant_id": "tenant-1", "page": 2, "limit": 5, "keyword": "analyst"}


def test_roster_list_post_creates_agent_and_returns_detail(app, monkeypatch):
    created_agent = SimpleNamespace(id="agent-1")
    monkeypatch.setattr(
        roster_controller.AgentRosterService,
        "create_roster_agent",
        lambda _self, **kwargs: created_agent,
    )
    monkeypatch.setattr(
        roster_controller.AgentRosterService,
        "get_roster_agent_detail",
        lambda _self, **kwargs: {"id": kwargs["agent_id"], "tenant_id": kwargs["tenant_id"]},
    )

    with app.test_request_context(json={"name": "Analyst", "agent_soul": {"prompt": {"system_prompt": "x"}}}):
        result, status = _unwrap(AgentRosterListApi.post)(AgentRosterListApi())

    assert status == 201
    assert result == {"id": "agent-1", "tenant_id": "tenant-1"}


def test_invite_options_get_parses_app_id(app, monkeypatch):
    captured = {}

    def list_invite_options(_self, **kwargs):
        captured.update(kwargs)
        return {"data": []}

    monkeypatch.setattr(roster_controller.AgentRosterService, "list_invite_options", list_invite_options)

    with app.test_request_context("/console/api/agents/invite-options?page=1&limit=10&app_id=app-1"):
        result = _unwrap(AgentInviteOptionsApi.get)(AgentInviteOptionsApi())

    assert result == {"data": []}
    assert captured == {"tenant_id": "tenant-1", "page": 1, "limit": 10, "keyword": None, "app_id": "app-1"}


def test_roster_detail_patch_delete_and_versions_call_services(app, monkeypatch):
    agent_id = "00000000-0000-0000-0000-000000000001"
    version_id = "00000000-0000-0000-0000-000000000002"
    archived = {}
    monkeypatch.setattr(
        roster_controller.AgentRosterService,
        "get_roster_agent_detail",
        lambda _self, **kwargs: {"id": kwargs["agent_id"]},
    )
    monkeypatch.setattr(
        roster_controller.AgentRosterService,
        "update_roster_agent",
        lambda _self, **kwargs: {"id": kwargs["agent_id"], "description": kwargs["payload"].description},
    )
    monkeypatch.setattr(
        roster_controller.AgentRosterService,
        "archive_roster_agent",
        lambda _self, **kwargs: archived.update(kwargs),
    )
    monkeypatch.setattr(
        roster_controller.AgentRosterService,
        "list_agent_versions",
        lambda _self, **kwargs: [{"id": "version-1"}],
    )
    monkeypatch.setattr(
        roster_controller.AgentRosterService,
        "get_agent_version_detail",
        lambda _self, **kwargs: {"id": kwargs["version_id"], "agent_id": kwargs["agent_id"]},
    )

    assert _unwrap(AgentRosterDetailApi.get)(AgentRosterDetailApi(), agent_id)["id"] == agent_id
    with app.test_request_context(json={"description": "updated"}):
        assert _unwrap(AgentRosterDetailApi.patch)(AgentRosterDetailApi(), agent_id)["description"] == "updated"
    assert _unwrap(AgentRosterDetailApi.delete)(AgentRosterDetailApi(), agent_id) == ("", 204)
    assert archived["account_id"] == "account-1"
    assert _unwrap(AgentRosterVersionsApi.get)(AgentRosterVersionsApi(), agent_id) == {"data": [{"id": "version-1"}]}
    assert _unwrap(AgentRosterVersionDetailApi.get)(AgentRosterVersionDetailApi(), agent_id, version_id) == {
        "id": version_id,
        "agent_id": agent_id,
    }


def test_workflow_composer_get_put_validate_candidates_impact_and_save(app, monkeypatch):
    app_model = SimpleNamespace(id="app-1")
    payload = {
        "variant": ComposerVariant.WORKFLOW.value,
        "save_strategy": ComposerSaveStrategy.NODE_JOB_ONLY.value,
        "binding": {"binding_type": "roster_agent", "current_snapshot_id": "version-1"},
    }
    monkeypatch.setattr(
        composer_controller.AgentComposerService,
        "load_workflow_composer",
        lambda **kwargs: {"node_id": kwargs["node_id"]},
    )
    monkeypatch.setattr(
        composer_controller.AgentComposerService,
        "save_workflow_composer",
        lambda **kwargs: {"saved": kwargs["payload"].save_strategy.value, "account_id": kwargs["account_id"]},
    )
    monkeypatch.setattr(composer_controller.ComposerConfigValidator, "validate_save_payload", lambda payload: None)
    monkeypatch.setattr(
        composer_controller.AgentComposerService,
        "get_workflow_candidates",
        lambda **kwargs: {"data": []},
    )
    monkeypatch.setattr(
        composer_controller.AgentComposerService,
        "calculate_impact",
        lambda **kwargs: {"current_snapshot_id": kwargs["current_snapshot_id"], "workflow_node_count": 1},
    )

    assert _unwrap(WorkflowAgentComposerApi.get)(WorkflowAgentComposerApi(), app_model, "node-1") == {
        "node_id": "node-1"
    }
    with app.test_request_context(json=payload):
        assert _unwrap(WorkflowAgentComposerApi.put)(WorkflowAgentComposerApi(), app_model, "node-1") == {
            "saved": "node_job_only",
            "account_id": "account-1",
        }
        assert _unwrap(WorkflowAgentComposerValidateApi.post)(
            WorkflowAgentComposerValidateApi(), app_model, "node-1"
        ) == {"result": "success", "errors": []}
    assert _unwrap(WorkflowAgentComposerCandidatesApi.get)(
        WorkflowAgentComposerCandidatesApi(), app_model, "node-1"
    ) == {"data": []}
    with app.test_request_context(json=payload):
        assert _unwrap(WorkflowAgentComposerImpactApi.post)(WorkflowAgentComposerImpactApi(), app_model, "node-1") == {
            "current_snapshot_id": "version-1",
            "workflow_node_count": 1,
        }
        assert (
            _unwrap(WorkflowAgentComposerSaveToRosterApi.post)(
                WorkflowAgentComposerSaveToRosterApi(), app_model, "node-1"
            )["saved"]
            == "node_job_only"
        )


def test_workflow_impact_returns_empty_without_version(app):
    payload = {"variant": ComposerVariant.WORKFLOW.value, "save_strategy": ComposerSaveStrategy.NODE_JOB_ONLY.value}

    with app.test_request_context(json=payload):
        result = _unwrap(WorkflowAgentComposerImpactApi.post)(
            WorkflowAgentComposerImpactApi(), SimpleNamespace(id="app-1"), "node-1"
        )

    assert result == {"current_snapshot_id": None, "workflow_node_count": 0, "bindings": []}


def test_agent_app_composer_get_put_validate_and_candidates(app, monkeypatch):
    app_model = SimpleNamespace(id="app-1")
    payload = {
        "variant": ComposerVariant.AGENT_APP.value,
        "save_strategy": ComposerSaveStrategy.SAVE_TO_CURRENT_VERSION.value,
        "agent_soul": {"prompt": {"system_prompt": "x"}},
    }
    monkeypatch.setattr(
        composer_controller.AgentComposerService,
        "load_agent_app_composer",
        lambda **kwargs: {"loaded": True},
    )
    monkeypatch.setattr(
        composer_controller.AgentComposerService,
        "save_agent_app_composer",
        lambda **kwargs: {"saved": kwargs["payload"].variant.value, "account_id": kwargs["account_id"]},
    )
    monkeypatch.setattr(composer_controller.ComposerConfigValidator, "validate_save_payload", lambda payload: None)
    monkeypatch.setattr(
        composer_controller.AgentComposerService,
        "get_agent_app_candidates",
        lambda **kwargs: {"data": []},
    )

    assert _unwrap(AgentAppComposerApi.get)(AgentAppComposerApi(), app_model) == {"loaded": True}
    with app.test_request_context(json=payload):
        assert _unwrap(AgentAppComposerApi.put)(AgentAppComposerApi(), app_model) == {
            "saved": "agent_app",
            "account_id": "account-1",
        }
        assert _unwrap(AgentAppComposerValidateApi.post)(AgentAppComposerValidateApi(), app_model) == {
            "result": "success",
            "errors": [],
        }
    assert _unwrap(AgentAppComposerCandidatesApi.get)(AgentAppComposerCandidatesApi(), app_model) == {"data": []}
