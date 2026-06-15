from inspect import unwrap
from types import SimpleNamespace
from typing import cast

import pytest
from flask import Flask

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
from models.model import AppMode
from services.entities.agent_entities import ComposerSaveStrategy, ComposerVariant


def _agent_response(agent_id: str = "agent-1") -> dict:
    return {
        "id": agent_id,
        "name": "Analyst",
        "description": "",
        "icon_type": None,
        "icon": None,
        "icon_background": None,
        "agent_kind": "dify_agent",
        "scope": "roster",
        "source": "agent_app",
        "app_id": None,
        "workflow_id": None,
        "workflow_node_id": None,
        "active_config_snapshot_id": "version-1",
        "active_config_snapshot": _version_response(),
        "status": "active",
        "created_by": "account-1",
        "updated_by": "account-1",
        "archived_by": None,
        "archived_at": None,
        "created_at": None,
        "updated_at": None,
    }


def _version_response(version_id: str = "version-1") -> dict:
    return {
        "id": version_id,
        "agent_id": "agent-1",
        "version": 1,
        "summary": None,
        "version_note": None,
        "created_by": "account-1",
        "created_at": None,
    }


def _workflow_composer_response(**overrides) -> dict:
    response = {
        "variant": "workflow",
        "agent": None,
        "active_config_snapshot": None,
        "binding": None,
        "soul_lock": {"locked": False, "can_unlock": False, "reason": "workflow_only_empty"},
        "agent_soul": {},
        "node_job": {},
        "effective_declared_outputs": [],
        "save_options": ["node_job_only"],
        "impact_summary": None,
        "app_id": "app-1",
        "workflow_id": "workflow-1",
        "node_id": "node-1",
    }
    response.update(overrides)
    return response


def _agent_app_composer_response() -> dict:
    return {
        "variant": "agent_app",
        "agent": {
            "id": "agent-1",
            "name": "Analyst",
            "description": "",
            "scope": "roster",
            "status": "active",
            "active_config_snapshot_id": "version-1",
        },
        "active_config_snapshot": _version_response(),
        "agent_soul": {},
        "save_options": ["save_to_current_version", "save_as_new_version"],
    }


def _candidates_response(variant: str) -> dict:
    return {
        "variant": variant,
        "allowed_node_job_candidates": {},
        "allowed_soul_candidates": {},
        "capabilities": {"human_roster_available": False},
    }


def _get_app_model_modes(view) -> list[AppMode]:
    current = view
    while current is not None:
        closure = getattr(current, "__closure__", None)
        if closure is not None:
            for cell in closure:
                try:
                    value = cell.cell_contents
                except ValueError:
                    continue
                if isinstance(value, list) and all(isinstance(item, AppMode) for item in value):
                    return value
        current = getattr(current, "__wrapped__", None)
    return []


@pytest.fixture
def account_id() -> str:
    return "account-1"


def test_roster_list_get_parses_query_and_calls_service(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    def list_roster_agents(_self: object, **kwargs: object) -> dict[str, object]:
        captured.update(kwargs)
        return {"data": [], "page": kwargs["page"], "limit": kwargs["limit"], "total": 0, "has_more": False}

    monkeypatch.setattr(roster_controller.AgentRosterService, "list_roster_agents", list_roster_agents)

    with app.test_request_context("/console/api/agents?page=2&limit=5&keyword=analyst"):
        result = unwrap(AgentRosterListApi.get)(AgentRosterListApi(), "tenant-1")

    assert result["page"] == 2
    assert captured == {"tenant_id": "tenant-1", "page": 2, "limit": 5, "keyword": "analyst"}


def test_roster_direct_mutation_endpoints_are_not_exposed() -> None:
    assert not hasattr(AgentRosterListApi, "post")
    assert not hasattr(AgentRosterDetailApi, "patch")
    assert not hasattr(AgentRosterDetailApi, "delete")


def test_invite_options_get_parses_app_id(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    def list_invite_options(_self: object, **kwargs: object) -> dict[str, object]:
        captured.update(kwargs)
        return {"data": [], "page": kwargs["page"], "limit": kwargs["limit"], "total": 0, "has_more": False}

    monkeypatch.setattr(roster_controller.AgentRosterService, "list_invite_options", list_invite_options)

    with app.test_request_context("/console/api/agents/invite-options?page=1&limit=10&app_id=app-1"):
        result = unwrap(AgentInviteOptionsApi.get)(AgentInviteOptionsApi(), "tenant-1")

    assert result == {"data": [], "page": 1, "limit": 10, "total": 0, "has_more": False}
    assert captured == {"tenant_id": "tenant-1", "page": 1, "limit": 10, "keyword": None, "app_id": "app-1"}


def test_roster_detail_and_versions_call_services(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    agent_id = "00000000-0000-0000-0000-000000000001"
    version_id = "00000000-0000-0000-0000-000000000002"
    monkeypatch.setattr(
        roster_controller.AgentRosterService,
        "get_roster_agent_detail",
        lambda _self, **kwargs: _agent_response(cast(str, kwargs["agent_id"])),
    )
    monkeypatch.setattr(
        roster_controller.AgentRosterService,
        "list_agent_versions",
        lambda _self, **kwargs: [_version_response()],
    )
    monkeypatch.setattr(
        roster_controller.AgentRosterService,
        "get_agent_version_detail",
        lambda _self, **kwargs: {
            **_version_response(cast(str, kwargs["version_id"])),
            "agent_id": kwargs["agent_id"],
            "config_snapshot": {},
            "revisions": [
                {
                    "id": "revision-1",
                    "previous_snapshot_id": None,
                    "current_snapshot_id": kwargs["version_id"],
                    "revision": 1,
                    "operation": "create_version",
                    "summary": None,
                    "version_note": None,
                    "created_by": "account-1",
                    "created_at": None,
                }
            ],
        },
    )

    assert unwrap(AgentRosterDetailApi.get)(AgentRosterDetailApi(), "tenant-1", agent_id)["id"] == agent_id
    assert (
        unwrap(AgentRosterVersionsApi.get)(AgentRosterVersionsApi(), "tenant-1", agent_id)["data"][0]["id"]
        == "version-1"
    )
    version_detail = unwrap(AgentRosterVersionDetailApi.get)(
        AgentRosterVersionDetailApi(), "tenant-1", agent_id, version_id
    )
    assert version_detail["id"] == version_id
    assert version_detail["agent_id"] == agent_id


def test_workflow_composer_get_put_validate_candidates_impact_and_save(
    app: Flask, monkeypatch: pytest.MonkeyPatch, account_id: str
) -> None:
    app_model = SimpleNamespace(id="app-1")
    payload = {
        "variant": ComposerVariant.WORKFLOW.value,
        "save_strategy": ComposerSaveStrategy.NODE_JOB_ONLY.value,
        "binding": {"binding_type": "roster_agent", "current_snapshot_id": "version-1"},
    }
    monkeypatch.setattr(
        composer_controller.AgentComposerService,
        "load_workflow_composer",
        lambda **kwargs: _workflow_composer_response(node_id=kwargs["node_id"]),
    )
    monkeypatch.setattr(
        composer_controller.AgentComposerService,
        "save_workflow_composer",
        lambda **kwargs: _workflow_composer_response(save_options=[kwargs["payload"].save_strategy.value]),
    )
    monkeypatch.setattr(composer_controller.ComposerConfigValidator, "validate_save_payload", lambda payload: None)
    monkeypatch.setattr(
        composer_controller.AgentComposerService, "resolve_workflow_node_agent_id", lambda **kwargs: None
    )
    monkeypatch.setattr(composer_controller.AgentComposerService, "resolve_bound_agent_id", lambda **kwargs: None)
    monkeypatch.setattr(
        composer_controller.AgentComposerService,
        "get_workflow_candidates",
        lambda **kwargs: _candidates_response("workflow"),
    )
    monkeypatch.setattr(
        composer_controller.AgentComposerService,
        "calculate_impact",
        lambda **kwargs: {
            "current_snapshot_id": kwargs["current_snapshot_id"],
            "workflow_node_count": 1,
            "bindings": [],
        },
    )

    workflow_state = unwrap(WorkflowAgentComposerApi.get)(WorkflowAgentComposerApi(), "tenant-1", app_model, "node-1")
    assert workflow_state["node_id"] == "node-1"
    with app.test_request_context(json=payload):
        saved_state = unwrap(WorkflowAgentComposerApi.put)(
            WorkflowAgentComposerApi(), "tenant-1", account_id, app_model, "node-1"
        )
        assert saved_state["save_options"] == ["node_job_only"]
        assert unwrap(WorkflowAgentComposerValidateApi.post)(
            WorkflowAgentComposerValidateApi(), "tenant-1", app_model, "node-1"
        ) == {"result": "success", "errors": [], "warnings": [], "knowledge_retrieval_placeholder": []}
    assert (
        unwrap(WorkflowAgentComposerCandidatesApi.get)(
            WorkflowAgentComposerCandidatesApi(), "tenant-1", account_id, app_model, "node-1"
        )["variant"]
        == "workflow"
    )
    with app.test_request_context(json=payload):
        assert unwrap(WorkflowAgentComposerImpactApi.post)(
            WorkflowAgentComposerImpactApi(), "tenant-1", app_model, "node-1"
        ) == {"current_snapshot_id": "version-1", "workflow_node_count": 1, "bindings": []}
        assert unwrap(WorkflowAgentComposerSaveToRosterApi.post)(
            WorkflowAgentComposerSaveToRosterApi(), "tenant-1", account_id, app_model, "node-1"
        )["save_options"] == ["node_job_only"]


def test_workflow_impact_returns_empty_without_version(app: Flask) -> None:
    payload = {"variant": ComposerVariant.WORKFLOW.value, "save_strategy": ComposerSaveStrategy.NODE_JOB_ONLY.value}

    with app.test_request_context(json=payload):
        result = unwrap(WorkflowAgentComposerImpactApi.post)(
            WorkflowAgentComposerImpactApi(), "tenant-1", SimpleNamespace(id="app-1"), "node-1"
        )

    assert result == {"current_snapshot_id": None, "workflow_node_count": 0, "bindings": []}


def test_agent_app_composer_get_put_validate_and_candidates(
    app: Flask, monkeypatch: pytest.MonkeyPatch, account_id: str
) -> None:
    app_model = SimpleNamespace(id="app-1")
    payload = {
        "variant": ComposerVariant.AGENT_APP.value,
        "save_strategy": ComposerSaveStrategy.SAVE_TO_CURRENT_VERSION.value,
        "agent_soul": {"prompt": {"system_prompt": "x"}},
    }
    monkeypatch.setattr(
        composer_controller.AgentComposerService,
        "load_agent_app_composer",
        lambda **kwargs: _agent_app_composer_response(),
    )
    monkeypatch.setattr(
        composer_controller.AgentComposerService,
        "save_agent_app_composer",
        lambda **kwargs: _agent_app_composer_response(),
    )
    monkeypatch.setattr(composer_controller.ComposerConfigValidator, "validate_save_payload", lambda payload: None)
    monkeypatch.setattr(
        composer_controller.AgentComposerService, "resolve_workflow_node_agent_id", lambda **kwargs: None
    )
    monkeypatch.setattr(composer_controller.AgentComposerService, "resolve_bound_agent_id", lambda **kwargs: None)
    monkeypatch.setattr(
        composer_controller.AgentComposerService,
        "get_agent_app_candidates",
        lambda **kwargs: _candidates_response("agent_app"),
    )

    assert unwrap(AgentAppComposerApi.get)(AgentAppComposerApi(), "tenant-1", app_model)["variant"] == "agent_app"
    with app.test_request_context(json=payload):
        assert (
            unwrap(AgentAppComposerApi.put)(AgentAppComposerApi(), "tenant-1", account_id, app_model)["variant"]
            == "agent_app"
        )
        assert unwrap(AgentAppComposerValidateApi.post)(AgentAppComposerValidateApi(), "tenant-1", app_model) == {
            "result": "success",
            "errors": [],
            "warnings": [],
            "knowledge_retrieval_placeholder": [],
        }
    agent_app_candidates = unwrap(AgentAppComposerCandidatesApi.get)(
        AgentAppComposerCandidatesApi(), "tenant-1", account_id, app_model
    )
    assert agent_app_candidates["variant"] == "agent_app"


def test_agent_app_composer_routes_are_agent_mode_only() -> None:
    assert _get_app_model_modes(AgentAppComposerApi.get) == [AppMode.AGENT]
    assert _get_app_model_modes(AgentAppComposerApi.put) == [AppMode.AGENT]
    assert _get_app_model_modes(AgentAppComposerValidateApi.post) == [AppMode.AGENT]
    assert _get_app_model_modes(AgentAppComposerCandidatesApi.get) == [AppMode.AGENT]


def test_dify_tool_candidate_response_keeps_granularity_fields():
    """Both selection granularities must survive the fields-layer model —
    the frontend needs granularity/tools_count to render the Tools menu."""
    from fields.agent_fields import AgentComposerDifyToolCandidateResponse

    provider_entry = AgentComposerDifyToolCandidateResponse.model_validate(
        {
            "id": "duckduckgo/*",
            "granularity": "provider",
            "name": "DuckDuckGo",
            "provider": "duckduckgo",
            "plugin_id": "langgenius/duckduckgo",
            "tools_count": 2,
        }
    ).model_dump(exclude_none=True)
    assert provider_entry["granularity"] == "provider"
    assert provider_entry["tools_count"] == 2
