from inspect import unwrap
from types import SimpleNamespace
from typing import Any, cast

import pytest
from flask import Flask

from controllers.console import console_ns
from controllers.console.agent import composer as composer_controller
from controllers.console.agent import roster as roster_controller
from controllers.console.agent.composer import (
    AgentComposerApi,
    AgentComposerCandidatesApi,
    AgentComposerValidateApi,
    WorkflowAgentComposerApi,
    WorkflowAgentComposerCandidatesApi,
    WorkflowAgentComposerImpactApi,
    WorkflowAgentComposerSaveToRosterApi,
    WorkflowAgentComposerValidateApi,
)
from controllers.console.agent.roster import (
    AgentAppApi,
    AgentAppListApi,
    AgentInviteOptionsApi,
    AgentRosterVersionDetailApi,
    AgentRosterVersionsApi,
)
from services.entities.agent_entities import ComposerSaveStrategy, ComposerVariant


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


def _app_detail_obj(**overrides):
    data = {
        "id": "app-1",
        "name": "Iris",
        "description": "Agent app",
        "mode_compatible_with_agent": "agent",
        "icon_type": "emoji",
        "icon": "robot",
        "icon_background": "#fff",
        "enable_site": False,
        "enable_api": False,
        "app_model_config": None,
        "workflow": None,
        "tracing": None,
        "use_icon_as_answer_icon": False,
        "created_by": "account-1",
        "created_at": None,
        "updated_by": "account-1",
        "updated_at": None,
        "access_mode": None,
        "tags": [],
        "api_base_url": None,
        "max_active_requests": 0,
        "deleted_tools": [],
        "site": None,
        "bound_agent_id": "00000000-0000-0000-0000-000000000001",
    }
    data.update(overrides)
    return SimpleNamespace(**data)


def _candidates_response(variant: str) -> dict:
    return {
        "variant": variant,
        "allowed_node_job_candidates": {},
        "allowed_soul_candidates": {},
        "capabilities": {"human_roster_available": False},
    }


def test_agent_v2_console_routes_are_agent_id_first() -> None:
    paths = {route for item in console_ns.resources for route in item.urls}

    for route in (
        "/agent",
        "/agent/<uuid:agent_id>",
        "/agent/<uuid:agent_id>/composer",
        "/agent/<uuid:agent_id>/composer/validate",
        "/agent/<uuid:agent_id>/composer/candidates",
        "/agent/<uuid:agent_id>/features",
        "/agent/<uuid:agent_id>/referencing-workflows",
        "/agent/<uuid:agent_id>/drive/files",
        "/agent/<uuid:agent_id>/sandbox/files",
        "/agent/<uuid:agent_id>/skills/upload",
        "/agent/<uuid:agent_id>/files",
        "/agent/invite-options",
    ):
        assert route in paths

    for route in (
        "/agents",
        "/agents/invite-options",
        "/agents/<uuid:agent_id>",
        "/agents/<uuid:agent_id>/versions",
        "/apps/<uuid:app_id>/agent-composer",
        "/apps/<uuid:app_id>/agent-composer/validate",
        "/apps/<uuid:app_id>/agent-composer/candidates",
        "/apps/<uuid:app_id>/agent-features",
        "/apps/<uuid:app_id>/agent-referencing-workflows",
        "/apps/<uuid:app_id>/agent-sandbox/files",
    ):
        assert route not in paths


@pytest.fixture
def account_id() -> str:
    return "account-1"


def test_agent_app_list_and_create_use_agent_route(
    app: Flask, monkeypatch: pytest.MonkeyPatch, account_id: str
) -> None:
    captured: dict[str, object] = {}

    class FakeAppService:
        def get_app(self, app_obj: object) -> object:
            return app_obj

        def get_paginate_apps(self, user_id: str, tenant_id: str, params) -> object:
            captured["list"] = {"user_id": user_id, "tenant_id": tenant_id, "params": params}
            return SimpleNamespace(
                page=1,
                per_page=10,
                total=1,
                has_next=False,
                items=[_app_detail_obj(id="app-list", bound_agent_id="agent-list")],
            )

        def create_app(self, tenant_id: str, params, current_user: object) -> object:
            captured["create"] = {"tenant_id": tenant_id, "params": params, "current_user": current_user}
            return _app_detail_obj(id="app-created", bound_agent_id="agent-created")

    monkeypatch.setattr(roster_controller, "AppService", FakeAppService)
    monkeypatch.setattr(
        roster_controller.FeatureService,
        "get_system_features",
        lambda: SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False)),
    )

    with app.test_request_context("/console/api/agent?page=1&limit=10&mode=workflow"):
        listed = unwrap(AgentAppListApi.get)(AgentAppListApi(), "tenant-1", SimpleNamespace(id=account_id))

    assert listed["page"] == 1
    assert listed["limit"] == 10
    assert listed["total"] == 1
    assert listed["data"][0]["id"] == "agent-list"
    assert "bound_agent_id" not in listed["data"][0]
    list_call = cast(dict[str, object], captured["list"])
    list_params = cast(Any, list_call["params"])
    assert list_params.mode == "agent"
    assert list_params.status == "normal"

    with app.test_request_context(
        "/console/api/agent",
        json={"name": "Iris", "description": "Agent app", "icon_type": "emoji", "icon": "robot"},
    ):
        created, status = unwrap(AgentAppListApi.post)(AgentAppListApi(), "tenant-1", SimpleNamespace(id=account_id))

    assert status == 201
    assert created["id"] == "agent-created"
    assert "bound_agent_id" not in created
    create_call = cast(dict[str, object], captured["create"])
    create_params = cast(Any, create_call["params"])
    assert create_params.mode == "agent"


def test_agent_app_detail_update_delete_resolve_app_from_agent_id(
    app: Flask, monkeypatch: pytest.MonkeyPatch, account_id: str
) -> None:
    agent_id = "00000000-0000-0000-0000-000000000001"
    app_model = _app_detail_obj(id="app-1", bound_agent_id=agent_id)
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        roster_controller.AgentRosterService,
        "get_agent_app_model",
        lambda _self, **kwargs: app_model,
    )
    monkeypatch.setattr(
        roster_controller.FeatureService,
        "get_system_features",
        lambda: SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False)),
    )

    class FakeAppService:
        def get_app(self, app_obj: object) -> object:
            captured["get_app"] = app_obj
            return app_obj

        def update_app(self, app_obj: object, args: dict[str, object]) -> object:
            captured["update"] = {"app": app_obj, "args": args}
            return _app_detail_obj(id="app-1", name=args["name"], bound_agent_id=agent_id)

        def delete_app(self, app_obj: object) -> None:
            captured["delete"] = app_obj

    monkeypatch.setattr(roster_controller, "AppService", FakeAppService)

    detail = unwrap(AgentAppApi.get)(AgentAppApi(), "tenant-1", agent_id)
    assert detail["id"] == agent_id
    assert "bound_agent_id" not in detail

    with app.test_request_context(
        "/console/api/agent/00000000-0000-0000-0000-000000000001",
        json={"name": "Renamed", "description": "", "icon_type": "emoji", "icon": "R"},
    ):
        updated = unwrap(AgentAppApi.put)(AgentAppApi(), "tenant-1", agent_id)

    assert updated["name"] == "Renamed"
    assert updated["id"] == agent_id
    assert "bound_agent_id" not in updated
    update_call = cast(dict[str, object], captured["update"])
    assert update_call["app"] is app_model

    deleted, status = unwrap(AgentAppApi.delete)(AgentAppApi(), "tenant-1", agent_id)
    assert (deleted, status) == ("", 204)
    assert captured["delete"] is app_model


def test_invite_options_get_parses_app_id(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    def list_invite_options(_self: object, **kwargs: object) -> dict[str, object]:
        captured.update(kwargs)
        return {"data": [], "page": kwargs["page"], "limit": kwargs["limit"], "total": 0, "has_more": False}

    monkeypatch.setattr(roster_controller.AgentRosterService, "list_invite_options", list_invite_options)

    with app.test_request_context("/console/api/agent/invite-options?page=1&limit=10&app_id=app-1"):
        result = unwrap(AgentInviteOptionsApi.get)(AgentInviteOptionsApi(), "tenant-1")

    assert result == {"data": [], "page": 1, "limit": 10, "total": 0, "has_more": False}
    assert captured == {"tenant_id": "tenant-1", "page": 1, "limit": 10, "keyword": None, "app_id": "app-1"}


def test_agent_versions_call_services(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    agent_id = "00000000-0000-0000-0000-000000000001"
    version_id = "00000000-0000-0000-0000-000000000002"
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


def test_agent_composer_routes_resolve_app_from_agent_id(
    app: Flask, monkeypatch: pytest.MonkeyPatch, account_id: str
) -> None:
    agent_id = "00000000-0000-0000-0000-000000000001"
    captured: dict[str, object] = {}
    payload = {
        "variant": ComposerVariant.AGENT_APP.value,
        "save_strategy": ComposerSaveStrategy.SAVE_TO_CURRENT_VERSION.value,
        "agent_soul": {"prompt": {"system_prompt": "x"}},
    }

    monkeypatch.setattr(composer_controller, "resolve_agent_app_model", lambda **kwargs: SimpleNamespace(id="app-1"))

    def load_agent_app_composer(**kwargs: object) -> dict:
        captured["load"] = kwargs
        return _agent_app_composer_response()

    def save_agent_app_composer(**kwargs: object) -> dict:
        captured["save"] = kwargs
        return _agent_app_composer_response()

    def collect_validation_findings(**kwargs: object) -> dict:
        captured["validate"] = kwargs
        return {"warnings": [], "knowledge_retrieval_placeholder": []}

    def get_agent_app_candidates(**kwargs: object) -> dict:
        captured["candidates"] = kwargs
        return _candidates_response("agent_app")

    monkeypatch.setattr(
        composer_controller.AgentComposerService,
        "load_agent_app_composer",
        load_agent_app_composer,
    )
    monkeypatch.setattr(
        composer_controller.AgentComposerService,
        "save_agent_app_composer",
        save_agent_app_composer,
    )
    monkeypatch.setattr(composer_controller.ComposerConfigValidator, "validate_save_payload", lambda payload: None)
    monkeypatch.setattr(
        composer_controller.AgentComposerService,
        "collect_validation_findings",
        collect_validation_findings,
    )
    monkeypatch.setattr(
        composer_controller.AgentComposerService,
        "get_agent_app_candidates",
        get_agent_app_candidates,
    )

    assert unwrap(AgentComposerApi.get)(AgentComposerApi(), "tenant-1", agent_id)["variant"] == "agent_app"
    assert cast(dict[str, object], captured["load"])["app_id"] == "app-1"

    with app.test_request_context(json=payload):
        assert (
            unwrap(AgentComposerApi.put)(AgentComposerApi(), "tenant-1", account_id, agent_id)["variant"] == "agent_app"
        )
        assert cast(dict[str, object], captured["save"])["app_id"] == "app-1"
        assert unwrap(AgentComposerValidateApi.post)(AgentComposerValidateApi(), "tenant-1", agent_id) == {
            "result": "success",
            "errors": [],
            "warnings": [],
            "knowledge_retrieval_placeholder": [],
        }
        assert cast(dict[str, object], captured["validate"])["agent_id"] == agent_id

    candidates = unwrap(AgentComposerCandidatesApi.get)(AgentComposerCandidatesApi(), "tenant-1", account_id, agent_id)
    assert candidates["variant"] == "agent_app"
    assert cast(dict[str, object], captured["candidates"])["app_id"] == "app-1"


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
