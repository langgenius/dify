from inspect import unwrap
from types import SimpleNamespace
from typing import Any, cast

import pytest
from flask import Flask
from werkzeug.exceptions import InternalServerError, NotFound

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
from controllers.console.app import completion as completion_controller
from controllers.console.app import message as message_controller
from controllers.console.app.completion import AgentChatMessageApi, AgentChatMessageStopApi
from controllers.console.app.message import (
    AgentChatMessageListApi,
    AgentMessageApi,
    AgentMessageFeedbackApi,
    AgentMessageSuggestedQuestionApi,
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
        "tenant_id": "tenant-1",
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
        "/agent/<uuid:agent_id>/chat-messages",
        "/agent/<uuid:agent_id>/chat-messages/<string:task_id>/stop",
        "/agent/<uuid:agent_id>/feedbacks",
        "/agent/<uuid:agent_id>/chat-messages/<uuid:message_id>/suggested-questions",
        "/agent/<uuid:agent_id>/messages/<uuid:message_id>",
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
        roster_controller.AgentRosterService,
        "load_app_backing_agents_by_app_id",
        lambda _self, **kwargs: {
            "app-list": SimpleNamespace(id="agent-list", role="List role", active_config_snapshot_id=None)
        },
    )
    monkeypatch.setattr(
        roster_controller.AgentRosterService,
        "get_app_backing_agent",
        lambda _self, **kwargs: SimpleNamespace(
            id="agent-created", role="Created role", active_config_snapshot_id=None
        ),
    )
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
    assert listed["data"][0]["app_id"] == "app-list"
    assert listed["data"][0]["role"] == "List role"
    assert listed["data"][0]["active_config_is_published"] is False
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
    assert created["app_id"] == "app-created"
    assert created["role"] == "Created role"
    assert created["active_config_is_published"] is False
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
        roster_controller.AgentRosterService,
        "get_app_backing_agent",
        lambda _self, **kwargs: SimpleNamespace(id=agent_id, role="Resolved role", active_config_snapshot_id=None),
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
    assert detail["app_id"] == "app-1"
    assert detail["role"] == "Resolved role"
    assert detail["active_config_is_published"] is False
    assert "bound_agent_id" not in detail

    with app.test_request_context(
        "/console/api/agent/00000000-0000-0000-0000-000000000001",
        json={"name": "Renamed", "description": "", "icon_type": "emoji", "icon": "R"},
    ):
        updated = unwrap(AgentAppApi.put)(AgentAppApi(), "tenant-1", agent_id)

    assert updated["name"] == "Renamed"
    assert updated["id"] == agent_id
    assert updated["app_id"] == "app-1"
    assert updated["role"] == "Resolved role"
    assert updated["active_config_is_published"] is False
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


def test_agent_chat_generate_and_stop_routes_resolve_app_from_agent_id(
    app: Flask, monkeypatch: pytest.MonkeyPatch, account_id: str
) -> None:
    agent_id = "00000000-0000-0000-0000-000000000001"
    app_model = SimpleNamespace(id="app-1", mode="agent")
    captured: dict[str, object] = {}

    def resolve_agent_app_model(**kwargs: object) -> object:
        captured["resolve"] = kwargs
        return app_model

    def create_chat_message(**kwargs: object) -> dict[str, object]:
        captured["create"] = kwargs
        return {"result": "generated"}

    def stop_chat_message(**kwargs: object) -> tuple[dict[str, object], int]:
        captured["stop"] = kwargs
        return {"result": "success"}, 200

    monkeypatch.setattr(completion_controller, "resolve_agent_app_model", resolve_agent_app_model)
    monkeypatch.setattr(completion_controller, "_create_chat_message", create_chat_message)
    monkeypatch.setattr(completion_controller, "_stop_chat_message", stop_chat_message)

    with app.test_request_context(json={"inputs": {}, "query": "hello"}):
        assert unwrap(AgentChatMessageApi.post)(
            AgentChatMessageApi(), "tenant-1", SimpleNamespace(id=account_id), agent_id
        ) == {"result": "generated"}

    assert cast(dict[str, object], captured["resolve"]) == {"tenant_id": "tenant-1", "agent_id": agent_id}
    create_call = cast(dict[str, object], captured["create"])
    assert create_call["app_model"] is app_model
    assert cast(SimpleNamespace, create_call["current_user"]).id == account_id

    assert unwrap(AgentChatMessageStopApi.post)(
        AgentChatMessageStopApi(), "tenant-1", account_id, agent_id, "task-1"
    ) == ({"result": "success"}, 200)
    stop_call = cast(dict[str, object], captured["stop"])
    assert stop_call == {"current_user_id": account_id, "app_model": app_model, "task_id": "task-1"}


def test_agent_chat_helper_forces_agent_streaming_and_external_trace(
    app: Flask, monkeypatch: pytest.MonkeyPatch, account_id: str
) -> None:
    app_model = SimpleNamespace(id="app-1", mode="agent")
    current_user = SimpleNamespace(id=account_id)
    captured: dict[str, object] = {}

    def generate(**kwargs: object) -> dict[str, object]:
        captured.update(kwargs)
        return {"answer": "ok"}

    monkeypatch.setattr(completion_controller.AppGenerateService, "generate", generate)
    monkeypatch.setattr(
        completion_controller.helper,
        "compact_generate_response",
        lambda response: {"response": response},
    )

    with app.test_request_context(
        json={"inputs": {}, "query": "hello", "response_mode": "streaming"},
        headers={"X-Trace-Id": "trace-1"},
    ):
        result = completion_controller._create_chat_message(current_user=current_user, app_model=app_model)

    assert result == {"response": {"answer": "ok"}}
    assert captured["app_model"] is app_model
    assert captured["user"] is current_user
    assert captured["streaming"] is True
    args = cast(dict[str, object], captured["args"])
    assert args["response_mode"] == "streaming"
    assert args["auto_generate_name"] is False
    assert args["external_trace_id"] == "trace-1"


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (completion_controller.services.errors.conversation.ConversationNotExistsError(), NotFound),
        (
            completion_controller.services.errors.conversation.ConversationCompletedError(),
            completion_controller.ConversationCompletedError,
        ),
        (
            completion_controller.services.errors.app_model_config.AppModelConfigBrokenError(),
            completion_controller.AppUnavailableError,
        ),
        (
            completion_controller.ProviderTokenNotInitError("not initialized"),
            completion_controller.ProviderNotInitializeError,
        ),
        (completion_controller.QuotaExceededError(), completion_controller.ProviderQuotaExceededError),
        (
            completion_controller.ModelCurrentlyNotSupportError(),
            completion_controller.ProviderModelCurrentlyNotSupportError,
        ),
        (completion_controller.InvokeRateLimitError("rate limited"), completion_controller.InvokeRateLimitHttpError),
        (completion_controller.InvokeError("invoke failed"), completion_controller.CompletionRequestError),
        (RuntimeError("unexpected"), InternalServerError),
    ],
)
def test_agent_chat_helper_maps_generation_errors(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    error: Exception,
    expected: type[Exception],
) -> None:
    app_model = SimpleNamespace(id="app-1", mode="chat")
    monkeypatch.setattr(completion_controller.AppGenerateService, "generate", lambda **_: (_ for _ in ()).throw(error))

    with app.test_request_context(json={"inputs": {}, "query": "hello"}):
        with pytest.raises(expected):
            completion_controller._create_chat_message(
                current_user=SimpleNamespace(id="account-1"),
                app_model=app_model,
            )


def test_agent_chat_message_routes_resolve_app_from_agent_id(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    agent_id = "00000000-0000-0000-0000-000000000001"
    message_id = "00000000-0000-0000-0000-000000000002"
    app_model = SimpleNamespace(id="app-1")
    current_user = SimpleNamespace(id="account-1")
    captured: dict[str, object] = {}

    def resolve_agent_app_model(**kwargs: object) -> object:
        captured["resolve"] = kwargs
        return app_model

    def list_chat_messages(**kwargs: object) -> dict[str, object]:
        captured["list"] = kwargs
        return {"data": []}

    def update_message_feedback(**kwargs: object) -> dict[str, object]:
        captured["feedback"] = kwargs
        return {"result": "success"}

    def get_message_suggested_questions(**kwargs: object) -> dict[str, object]:
        captured["suggested"] = kwargs
        return {"data": ["next"]}

    def get_message_detail(**kwargs: object) -> dict[str, object]:
        captured["detail"] = kwargs
        return {"id": message_id}

    monkeypatch.setattr(message_controller, "resolve_agent_app_model", resolve_agent_app_model)
    monkeypatch.setattr(message_controller, "_list_chat_messages", list_chat_messages)
    monkeypatch.setattr(message_controller, "_update_message_feedback", update_message_feedback)
    monkeypatch.setattr(message_controller, "_get_message_suggested_questions", get_message_suggested_questions)
    monkeypatch.setattr(message_controller, "_get_message_detail", get_message_detail)

    assert unwrap(AgentChatMessageListApi.get)(AgentChatMessageListApi(), "tenant-1", agent_id) == {"data": []}
    assert cast(dict[str, object], captured["list"])["app_model"] is app_model

    with app.test_request_context(json={"message_id": message_id, "rating": "like"}):
        assert unwrap(AgentMessageFeedbackApi.post)(AgentMessageFeedbackApi(), "tenant-1", current_user, agent_id) == {
            "result": "success"
        }
    feedback_call = cast(dict[str, object], captured["feedback"])
    assert feedback_call["app_model"] is app_model
    assert feedback_call["current_user"] is current_user

    assert unwrap(AgentMessageSuggestedQuestionApi.get)(
        AgentMessageSuggestedQuestionApi(), "tenant-1", current_user, agent_id, message_id
    ) == {"data": ["next"]}
    suggested_call = cast(dict[str, object], captured["suggested"])
    assert suggested_call["app_model"] is app_model
    assert suggested_call["current_user"] is current_user
    assert suggested_call["message_id"] == message_id

    assert unwrap(AgentMessageApi.get)(AgentMessageApi(), "tenant-1", agent_id, message_id) == {"id": message_id}
    detail_call = cast(dict[str, object], captured["detail"])
    assert detail_call == {"app_model": app_model, "message_id": message_id}


def test_list_chat_messages_supports_first_id_pagination(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    conversation_id = "00000000-0000-0000-0000-000000000010"
    first_message_id = "00000000-0000-0000-0000-000000000011"
    older_message_id = "00000000-0000-0000-0000-000000000012"
    conversation = SimpleNamespace(id=conversation_id)
    first_message = SimpleNamespace(id=first_message_id, created_at=2)
    older_message = SimpleNamespace(id=older_message_id, created_at=1)
    scalar_values = iter([conversation, first_message, True])
    scalars_result = SimpleNamespace(all=lambda: [older_message])
    session = SimpleNamespace(
        scalar=lambda _stmt: next(scalar_values),
        scalars=lambda _stmt: scalars_result,
    )

    class FakeMessagePaginationResponse:
        @classmethod
        def model_validate(cls, pagination: object, from_attributes: bool = False) -> object:
            return SimpleNamespace(
                model_dump=lambda mode: {
                    "data": [item.id for item in pagination.data],
                    "limit": pagination.limit,
                    "has_more": pagination.has_more,
                }
            )

    monkeypatch.setattr(message_controller, "db", SimpleNamespace(session=session))
    monkeypatch.setattr(message_controller, "attach_message_extra_contents", lambda messages: None)
    monkeypatch.setattr(message_controller, "MessageInfiniteScrollPaginationResponse", FakeMessagePaginationResponse)

    with app.test_request_context(
        "/console/api/agent/agent-1/chat-messages"
        f"?conversation_id={conversation_id}&first_id={first_message_id}&limit=1"
    ):
        result = message_controller._list_chat_messages(app_model=SimpleNamespace(id="app-1"))

    assert result == {"data": [older_message_id], "limit": 1, "has_more": True}


def test_update_message_feedback_rejects_empty_rating_without_existing_feedback(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    message_id = "00000000-0000-0000-0000-000000000002"
    message = SimpleNamespace(id=message_id, app_id="app-1", admin_feedback=None)
    session = SimpleNamespace(scalar=lambda _stmt: message)
    monkeypatch.setattr(message_controller, "db", SimpleNamespace(session=session))

    with app.test_request_context(json={"message_id": message_id, "rating": None}):
        with pytest.raises(ValueError, match="rating cannot be None"):
            message_controller._update_message_feedback(
                current_user=SimpleNamespace(id="account-1"),
                app_model=SimpleNamespace(id="app-1"),
            )


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (message_controller.MessageNotExistsError(), NotFound),
        (message_controller.ConversationNotExistsError(), NotFound),
        (
            message_controller.ProviderTokenNotInitError("not initialized"),
            message_controller.ProviderNotInitializeError,
        ),
        (message_controller.QuotaExceededError(), message_controller.ProviderQuotaExceededError),
        (message_controller.ModelCurrentlyNotSupportError(), message_controller.ProviderModelCurrentlyNotSupportError),
        (message_controller.InvokeError("invoke failed"), message_controller.CompletionRequestError),
        (
            message_controller.SuggestedQuestionsAfterAnswerDisabledError(),
            message_controller.AppSuggestedQuestionsAfterAnswerDisabledError,
        ),
        (RuntimeError("unexpected"), InternalServerError),
    ],
)
def test_get_message_suggested_questions_maps_service_errors(
    monkeypatch: pytest.MonkeyPatch,
    error: Exception,
    expected: type[Exception],
) -> None:
    monkeypatch.setattr(
        message_controller.MessageService,
        "get_suggested_questions_after_answer",
        lambda **_: (_ for _ in ()).throw(error),
    )

    with pytest.raises(expected):
        message_controller._get_message_suggested_questions(
            current_user=SimpleNamespace(id="account-1"),
            app_model=SimpleNamespace(id="app-1"),
            message_id="00000000-0000-0000-0000-000000000002",
        )


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
