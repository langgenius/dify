from inspect import getsource, unwrap
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import Mock

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
    WorkflowAgentComposerCopyFromRosterApi,
    WorkflowAgentComposerImpactApi,
    WorkflowAgentComposerSaveToRosterApi,
    WorkflowAgentComposerValidateApi,
)
from controllers.console.agent.roster import (
    AgentApiAccessApi,
    AgentApiKeyApi,
    AgentApiKeyListApi,
    AgentApiStatusApi,
    AgentAppApi,
    AgentAppCopyApi,
    AgentAppListApi,
    AgentBuildDraftApi,
    AgentBuildDraftApplyApi,
    AgentBuildDraftCheckoutApi,
    AgentDebugConversationRefreshApi,
    AgentInviteOptionsApi,
    AgentLogMessagesApi,
    AgentLogsApi,
    AgentLogSourcesApi,
    AgentPublishApi,
    AgentRosterVersionDetailApi,
    AgentRosterVersionRestoreApi,
    AgentRosterVersionsApi,
    AgentStatisticsSummaryApi,
)
from controllers.console.app import completion as completion_controller
from controllers.console.app import message as message_controller
from controllers.console.app.completion import (
    AgentBuildChatFinalizeApi,
    AgentChatMessageApi,
    AgentChatMessageStopApi,
)
from controllers.console.app.error import CompletionRequestError
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
        "save_options": ["save_to_current_version"],
    }


def _app_detail_obj(**overrides):
    data = {
        "id": "app-1",
        "tenant_id": "tenant-1",
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
        "/agent/<uuid:agent_id>/copy",
        "/agent/<uuid:agent_id>/publish",
        "/agent/<uuid:agent_id>/build-draft/checkout",
        "/agent/<uuid:agent_id>/build-draft",
        "/agent/<uuid:agent_id>/build-draft/apply",
        "/agent/<uuid:agent_id>/referencing-workflows",
        "/agent/<uuid:agent_id>/drive/files",
        "/agent/<uuid:agent_id>/sandbox/files",
        "/agent/<uuid:agent_id>/skills/upload",
        "/agent/<uuid:agent_id>/files",
        "/agent/<uuid:agent_id>/api-access",
        "/agent/<uuid:agent_id>/api-enable",
        "/agent/<uuid:agent_id>/api-keys",
        "/agent/<uuid:agent_id>/api-keys/<uuid:api_key_id>",
        "/agent/<uuid:agent_id>/debug-conversation/refresh",
        "/agent/<uuid:agent_id>/chat-messages",
        "/agent/<uuid:agent_id>/chat-messages/<string:task_id>/stop",
        "/agent/<uuid:agent_id>/feedbacks",
        "/agent/<uuid:agent_id>/chat-messages/<uuid:message_id>/suggested-questions",
        "/agent/<uuid:agent_id>/messages/<uuid:message_id>",
        "/agent/<uuid:agent_id>/logs",
        "/agent/<uuid:agent_id>/logs/<uuid:conversation_id>/messages",
        "/agent/<uuid:agent_id>/log-sources",
        "/agent/<uuid:agent_id>/statistics/summary",
        "/agent/<uuid:agent_id>/versions",
        "/agent/<uuid:agent_id>/versions/<uuid:version_id>",
        "/agent/<uuid:agent_id>/versions/<uuid:version_id>/restore",
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
        "/apps/<uuid:agent_id>/api-access",
    ):
        assert route not in paths


def test_agent_app_write_routes_do_not_reuse_app_billing_quota() -> None:
    for route_class in (AgentAppListApi, AgentAppCopyApi):
        assert '@cloud_edition_billing_resource_check("apps")' not in getsource(route_class)


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

        def get_paginate_apps(self, user_id: str, tenant_id: str, params, session) -> object:
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
            "app-list": SimpleNamespace(
                id="agent-list",
                app_id="app-list",
                backing_app_id=None,
                role="List role",
                debug_conversation_id="debug-conversation-list",
                active_config_snapshot_id=None,
            )
        },
    )
    monkeypatch.setattr(
        roster_controller.AgentRosterService,
        "get_app_backing_agent",
        lambda _self, **kwargs: SimpleNamespace(
            id="agent-created",
            app_id="app-created",
            backing_app_id=None,
            role="Created role",
            debug_conversation_id="debug-conversation-created",
            active_config_snapshot_id=None,
        ),
    )
    monkeypatch.setattr(
        roster_controller.AgentRosterService,
        "get_or_create_agent_app_debug_conversation_id",
        lambda _self, **kwargs: "debug-conversation-detail",
    )
    monkeypatch.setattr(
        roster_controller.AgentRosterService,
        "get_or_create_agent_app_debug_conversation_id",
        lambda _self, **kwargs: "debug-conversation-detail",
    )
    monkeypatch.setattr(
        roster_controller.AgentRosterService,
        "load_published_references_by_agent_id",
        lambda _self, **kwargs: {
            "agent-list": [
                {
                    "app_id": "workflow-app-id",
                    "app_name": "RFP Review Flow",
                    "app_icon_type": "emoji",
                    "app_icon": "A",
                    "app_icon_background": "#fff",
                    "app_mode": "workflow",
                    "app_updated_at": 1781660000,
                    "workflow_id": "workflow-1",
                    "workflow_version": "v1",
                    "node_ids": ["node-1", "node-2"],
                }
            ]
        },
    )
    monkeypatch.setattr(
        roster_controller.AgentRosterService,
        "load_or_create_agent_app_debug_conversation_ids_by_agent_id",
        lambda _self, **kwargs: {"agent-list": "debug-conversation-list"},
    )
    monkeypatch.setattr(
        roster_controller.AgentRosterService,
        "count_agent_app_debug_conversation_messages",
        lambda _self, **kwargs: 0,
    )
    monkeypatch.setattr(
        roster_controller.AgentRosterService,
        "get_or_create_agent_app_debug_conversation_id",
        lambda _self, **kwargs: "debug-conversation-created",
    )
    monkeypatch.setattr(
        roster_controller.FeatureService,
        "get_system_features",
        lambda: SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False)),
    )

    with app.test_request_context(
        "/console/api/agent?page=1&limit=10&mode=workflow&sort_by=recently_created&is_created_by_me=true"
    ):
        listed = unwrap(AgentAppListApi.get)(AgentAppListApi(), "tenant-1", SimpleNamespace(id=account_id))

    assert listed["page"] == 1
    assert listed["limit"] == 10
    assert listed["total"] == 1
    assert listed["data"][0]["id"] == "agent-list"
    assert listed["data"][0]["app_id"] == "app-list"
    assert listed["data"][0]["debug_conversation_id"] == "debug-conversation-list"
    assert listed["data"][0]["role"] == "List role"
    assert listed["data"][0]["active_config_is_published"] is False
    assert listed["data"][0]["published_reference_count"] == 1
    assert listed["data"][0]["published_references"] == [
        {
            "app_id": "workflow-app-id",
            "app_name": "RFP Review Flow",
            "app_icon_type": "emoji",
            "app_icon": "A",
            "app_icon_background": "#fff",
        }
    ]
    assert "bound_agent_id" not in listed["data"][0]
    list_call = cast(dict[str, object], captured["list"])
    list_params = cast(Any, list_call["params"])
    assert list_params.mode == "agent"
    assert list_params.sort_by == "recently_created"
    assert list_params.is_created_by_me is True
    assert list_params.status == "normal"

    with app.test_request_context(
        "/console/api/agent",
        json={
            "name": "Iris",
            "description": "Agent app",
            "role": "Coordinator",
            "icon_type": "emoji",
            "icon": "robot",
        },
    ):
        created, status = unwrap(AgentAppListApi.post)(AgentAppListApi(), "tenant-1", SimpleNamespace(id=account_id))

    assert status == 201
    assert created["id"] == "agent-created"
    assert created["app_id"] == "app-created"
    assert created["debug_conversation_id"] == "debug-conversation-created"
    assert created["role"] == "Created role"
    assert created["active_config_is_published"] is False
    assert "bound_agent_id" not in created
    create_call = cast(dict[str, object], captured["create"])
    create_params = cast(Any, create_call["params"])
    assert create_params.mode == "agent"
    assert create_params.agent_role == "Coordinator"


def test_agent_app_create_payload_allows_optional_role() -> None:
    omitted = roster_controller.AgentAppCreatePayload.model_validate(
        {"name": "Iris", "description": "Agent app", "icon_type": "emoji", "icon": "robot"}
    )
    blank = roster_controller.AgentAppCreatePayload.model_validate(
        {"name": "Iris", "description": "Agent app", "role": "   ", "icon_type": "emoji", "icon": "robot"}
    )

    assert omitted.role is None
    assert blank.role == ""


def test_agent_app_create_omits_optional_role_as_empty_string(
    app: Flask, monkeypatch: pytest.MonkeyPatch, account_id: str
) -> None:
    captured: dict[str, object] = {}

    class FakeAppService:
        def create_app(self, tenant_id: str, params: object, account: object) -> object:
            captured["create"] = {"tenant_id": tenant_id, "params": params, "account": account}
            return _app_detail_obj(id="app-created", bound_agent_id="agent-created")

    monkeypatch.setattr(roster_controller, "AppService", FakeAppService)
    monkeypatch.setattr(
        roster_controller,
        "_serialize_agent_app_detail",
        lambda app_model, **_kwargs: {"id": "agent-created", "app_id": app_model.id},
    )

    current_user = SimpleNamespace(id=account_id)
    with app.test_request_context(
        "/console/api/agent",
        json={
            "name": "No-role Iris",
            "description": "Agent app",
            "icon_type": "emoji",
            "icon": "robot",
        },
    ):
        created, status = unwrap(AgentAppListApi.post)(AgentAppListApi(), "tenant-1", current_user)

    assert status == 201
    assert created == {"id": "agent-created", "app_id": "app-created"}
    create_call = cast(dict[str, object], captured["create"])
    create_params = cast(Any, create_call["params"])
    assert create_call["tenant_id"] == "tenant-1"
    assert create_call["account"] is current_user
    assert create_params.agent_role == ""


def test_agent_app_detail_update_delete_resolve_app_from_agent_id(
    app: Flask, monkeypatch: pytest.MonkeyPatch, account_id: str
) -> None:
    agent_id = "00000000-0000-0000-0000-000000000001"
    app_model = _app_detail_obj(id="app-1", bound_agent_id=agent_id)
    agent = SimpleNamespace(
        id=agent_id,
        app_id="app-1",
        backing_app_id=None,
        role="Resolved role",
        debug_conversation_id="debug-conversation-detail",
        active_config_snapshot_id=None,
    )
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        roster_controller.AgentRosterService,
        "get_agent_app_model",
        lambda _self, **kwargs: app_model,
    )
    monkeypatch.setattr(roster_controller, "resolve_agent_runtime_app_model", lambda **kwargs: app_model)
    monkeypatch.setattr(roster_controller.db.session, "scalar", lambda _stmt: agent)
    monkeypatch.setattr(
        roster_controller.AgentRosterService,
        "get_app_backing_agent",
        lambda _self, **kwargs: agent,
    )
    monkeypatch.setattr(
        roster_controller.AgentRosterService,
        "get_or_create_agent_app_debug_conversation_id",
        lambda _self, **kwargs: "debug-conversation-detail",
    )
    monkeypatch.setattr(
        roster_controller.AgentRosterService,
        "count_agent_app_debug_conversation_messages",
        lambda _self, **kwargs: 2,
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

    detail = unwrap(AgentAppApi.get)(AgentAppApi(), "tenant-1", SimpleNamespace(id=account_id), agent_id)
    assert detail["id"] == agent_id
    assert detail["app_id"] == "app-1"
    assert detail["debug_conversation_id"] == "debug-conversation-detail"
    assert detail["debug_conversation_has_messages"] is True
    assert detail["debug_conversation_message_count"] == 2
    assert detail["role"] == "Resolved role"
    assert detail["active_config_is_published"] is False
    assert "bound_agent_id" not in detail

    with app.test_request_context(
        "/console/api/agent/00000000-0000-0000-0000-000000000001",
        json={"name": "Renamed", "description": "", "role": "Reviewer", "icon_type": "emoji", "icon": "R"},
    ):
        updated = unwrap(AgentAppApi.put)(AgentAppApi(), "tenant-1", SimpleNamespace(id=account_id), agent_id)

    assert updated["name"] == "Renamed"
    assert updated["id"] == agent_id
    assert updated["app_id"] == "app-1"
    assert updated["debug_conversation_id"] == "debug-conversation-detail"
    assert updated["debug_conversation_has_messages"] is True
    assert updated["debug_conversation_message_count"] == 2
    assert updated["role"] == "Resolved role"
    assert updated["active_config_is_published"] is False
    assert "bound_agent_id" not in updated
    update_call = cast(dict[str, object], captured["update"])
    assert update_call["app"] is app_model
    assert cast(dict[str, object], update_call["args"])["role"] == "Reviewer"

    deleted, status = unwrap(AgentAppApi.delete)(AgentAppApi(), "tenant-1", agent_id)
    assert (deleted, status) == ("", 204)
    assert captured["delete"] is app_model


def test_agent_app_copy_uses_agent_id_and_returns_agent_detail(
    app: Flask, monkeypatch: pytest.MonkeyPatch, account_id: str
) -> None:
    agent_id = "00000000-0000-0000-0000-000000000001"
    current_user = SimpleNamespace(id=account_id)
    copied_app = _app_detail_obj(id="copied-app", bound_agent_id="copied-agent")
    captured: dict[str, object] = {}

    class FakeRosterService:
        def duplicate_agent_app(self, **kwargs: object) -> object:
            captured.update(kwargs)
            return copied_app

    monkeypatch.setattr(roster_controller, "_agent_roster_service", lambda: FakeRosterService())
    monkeypatch.setattr(
        roster_controller,
        "_serialize_agent_app_detail",
        lambda app_model, **_kwargs: {"id": "copied-agent", "app_id": app_model.id, "name": app_model.name},
    )

    with app.test_request_context(
        "/console/api/agent/00000000-0000-0000-0000-000000000001/copy",
        json={
            "name": "Iris copy",
            "description": "Copied",
            "role": "Copied role",
            "icon_type": "emoji",
            "icon": "sparkles",
            "icon_background": "#fff",
        },
    ):
        copied, status = unwrap(AgentAppCopyApi.post)(AgentAppCopyApi(), "tenant-1", current_user, agent_id)

    assert status == 201
    assert copied == {"id": "copied-agent", "app_id": "copied-app", "name": "Iris"}
    assert captured == {
        "tenant_id": "tenant-1",
        "agent_id": agent_id,
        "account": current_user,
        "name": "Iris copy",
        "description": "Copied",
        "role": "Copied role",
        "icon_type": "emoji",
        "icon": "sparkles",
        "icon_background": "#fff",
    }


def test_agent_debug_conversation_refresh_uses_current_user(
    app: Flask, monkeypatch: pytest.MonkeyPatch, account_id: str
) -> None:
    agent_id = "00000000-0000-0000-0000-000000000001"
    captured: dict[str, object] = {}

    class FakeRosterService:
        def refresh_agent_app_debug_conversation_id(self, **kwargs: object) -> str:
            captured.update(kwargs)
            return "new-debug-conversation-id"

    monkeypatch.setattr(roster_controller, "_agent_roster_service", lambda: FakeRosterService())

    with app.test_request_context(
        "/console/api/agent/00000000-0000-0000-0000-000000000001/debug-conversation/refresh",
        method="POST",
    ):
        response = unwrap(AgentDebugConversationRefreshApi.post)(
            AgentDebugConversationRefreshApi(),
            "tenant-1",
            SimpleNamespace(id=account_id),
            agent_id,
        )

    assert response == {
        "debug_conversation_id": "new-debug-conversation-id",
        "debug_conversation_has_messages": False,
        "debug_conversation_message_count": 0,
    }
    assert captured == {
        "tenant_id": "tenant-1",
        "agent_id": agent_id,
        "account_id": account_id,
    }


def test_agent_publish_and_build_draft_routes_call_composer_service(
    app: Flask, monkeypatch: pytest.MonkeyPatch, account_id: str
) -> None:
    agent_id = "00000000-0000-0000-0000-000000000001"
    current_user = SimpleNamespace(id=account_id)
    captured: dict[str, object] = {}

    def publish_agent_app_draft(**kwargs: object) -> dict[str, object]:
        captured["publish"] = kwargs
        return {"result": "success", "active_config_snapshot_id": "version-1"}

    def checkout_agent_app_build_draft(**kwargs: object) -> dict[str, object]:
        captured["checkout"] = kwargs
        return {"variant": "agent_app", "draft": {"id": "build-draft-1"}, "agent_soul": {}}

    def load_agent_app_build_draft(**kwargs: object) -> dict[str, object]:
        captured["load"] = kwargs
        return {"variant": "agent_app", "draft": {"id": "build-draft-1"}, "agent_soul": {}}

    def save_agent_app_build_draft(**kwargs: object) -> dict[str, object]:
        captured["save"] = kwargs
        return {"variant": "agent_app", "draft": {"id": "build-draft-1"}, "agent_soul": {}}

    def apply_agent_app_build_draft(**kwargs: object) -> dict[str, object]:
        captured["apply"] = kwargs
        return {"result": "success", "draft": {"id": "draft-1"}}

    def discard_agent_app_build_draft(**kwargs: object) -> dict[str, object]:
        captured["discard"] = kwargs
        return {"result": "success"}

    monkeypatch.setattr(
        roster_controller.AgentComposerService,
        "publish_agent_app_draft",
        publish_agent_app_draft,
    )
    monkeypatch.setattr(
        roster_controller.AgentComposerService,
        "checkout_agent_app_build_draft",
        checkout_agent_app_build_draft,
    )
    monkeypatch.setattr(
        roster_controller.AgentComposerService,
        "load_agent_app_build_draft",
        load_agent_app_build_draft,
    )
    monkeypatch.setattr(
        roster_controller.AgentComposerService,
        "save_agent_app_build_draft",
        save_agent_app_build_draft,
    )
    monkeypatch.setattr(
        roster_controller.AgentComposerService,
        "apply_agent_app_build_draft",
        apply_agent_app_build_draft,
    )
    monkeypatch.setattr(
        roster_controller.AgentComposerService,
        "discard_agent_app_build_draft",
        discard_agent_app_build_draft,
    )

    with app.test_request_context(
        "/console/api/agent/00000000-0000-0000-0000-000000000001/publish",
        json={"version_note": "publish v1"},
    ):
        published = unwrap(AgentPublishApi.post)(AgentPublishApi(), "tenant-1", current_user, agent_id)
    assert published["active_config_snapshot_id"] == "version-1"
    assert captured["publish"] == {
        "tenant_id": "tenant-1",
        "agent_id": agent_id,
        "account_id": account_id,
        "version_note": "publish v1",
    }

    with app.test_request_context(
        "/console/api/agent/00000000-0000-0000-0000-000000000001/build-draft/checkout",
        json={"force": True},
    ):
        checked_out = unwrap(AgentBuildDraftCheckoutApi.post)(
            AgentBuildDraftCheckoutApi(), "tenant-1", current_user, agent_id
        )
    assert checked_out["draft"]["id"] == "build-draft-1"
    assert captured["checkout"] == {
        "tenant_id": "tenant-1",
        "agent_id": agent_id,
        "account_id": account_id,
        "force": True,
    }

    with app.test_request_context("/console/api/agent/00000000-0000-0000-0000-000000000001/build-draft"):
        loaded = unwrap(AgentBuildDraftApi.get)(AgentBuildDraftApi(), "tenant-1", current_user, agent_id)
    assert loaded["draft"]["id"] == "build-draft-1"
    assert captured["load"] == {"tenant_id": "tenant-1", "agent_id": agent_id, "account_id": account_id}

    with app.test_request_context(
        "/console/api/agent/00000000-0000-0000-0000-000000000001/build-draft",
        json={"variant": "agent_app", "save_strategy": "save_to_current_version", "agent_soul": {}},
    ):
        saved = unwrap(AgentBuildDraftApi.put)(AgentBuildDraftApi(), "tenant-1", current_user, agent_id)
    assert saved["draft"]["id"] == "build-draft-1"
    assert captured["save"]["tenant_id"] == "tenant-1"
    assert captured["save"]["agent_id"] == agent_id
    assert captured["save"]["account_id"] == account_id
    assert captured["save"]["payload"].variant == ComposerVariant.AGENT_APP

    with app.test_request_context(
        "/console/api/agent/00000000-0000-0000-0000-000000000001/build-draft/apply",
        method="POST",
    ):
        applied = unwrap(AgentBuildDraftApplyApi.post)(AgentBuildDraftApplyApi(), "tenant-1", current_user, agent_id)
    assert applied == {"result": "success", "draft": {"id": "draft-1"}}
    assert captured["apply"] == {"tenant_id": "tenant-1", "agent_id": agent_id, "account_id": account_id}

    with app.test_request_context(
        "/console/api/agent/00000000-0000-0000-0000-000000000001/build-draft",
        method="DELETE",
    ):
        discarded = unwrap(AgentBuildDraftApi.delete)(AgentBuildDraftApi(), "tenant-1", current_user, agent_id)
    assert discarded == {"result": "success"}
    assert captured["discard"] == {"tenant_id": "tenant-1", "agent_id": agent_id, "account_id": account_id}


def test_agent_api_access_uses_agent_id_and_returns_service_api_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    agent_id = "00000000-0000-0000-0000-000000000001"
    app_model = SimpleNamespace(
        id="app-1",
        enable_api=True,
        api_base_url="https://api.example.test/v1",
        api_rpm=60,
        api_rph=600,
    )
    monkeypatch.setattr(roster_controller, "_resolve_agent_app_model", lambda **kwargs: app_model)
    monkeypatch.setattr(roster_controller, "_agent_api_key_count", lambda app_id: 2)

    response = unwrap(AgentApiAccessApi.get)(AgentApiAccessApi(), "tenant-1", agent_id)

    assert response == {
        "enabled": True,
        "service_api_base_url": "https://api.example.test/v1",
        "streaming_only": True,
        "chat_endpoint": "https://api.example.test/v1/chat-messages",
        "stop_endpoint": "https://api.example.test/v1/chat-messages/{task_id}/stop",
        "conversations_endpoint": "https://api.example.test/v1/conversations",
        "messages_endpoint": "https://api.example.test/v1/messages",
        "files_upload_endpoint": "https://api.example.test/v1/files/upload",
        "parameters_endpoint": "https://api.example.test/v1/parameters",
        "info_endpoint": "https://api.example.test/v1/info",
        "meta_endpoint": "https://api.example.test/v1/meta",
        "api_rpm": 60,
        "api_rph": 600,
        "api_key_count": 2,
    }


def test_agent_api_status_and_key_routes_resolve_backing_app(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    agent_id = "00000000-0000-0000-0000-000000000001"
    api_key_id = "00000000-0000-0000-0000-000000000002"
    app_model = SimpleNamespace(
        id="app-1",
        enable_api=False,
        api_base_url="https://api.example.test/v1",
        api_rpm=0,
        api_rph=0,
    )
    captured: dict[str, object] = {}

    monkeypatch.setattr(roster_controller, "_resolve_agent_app_model", lambda **kwargs: app_model)
    monkeypatch.setattr(roster_controller, "_agent_api_key_count", lambda app_id: 1)

    class FakeAppService:
        def update_app_api_status(self, app_obj: object, enable_api: bool) -> object:
            captured["enable"] = {"app": app_obj, "enable_api": enable_api}
            app_model.enable_api = enable_api
            return app_model

    monkeypatch.setattr(roster_controller, "AppService", FakeAppService)

    def fake_get_api_key_list(self, resource_id: str, tenant_id: str):
        captured["list_keys"] = {"resource_id": resource_id, "tenant_id": tenant_id}
        return roster_controller.ApiKeyList(data=[])

    def fake_create_api_key(self, resource_id: str, tenant_id: str):
        captured["create_key"] = {"resource_id": resource_id, "tenant_id": tenant_id}
        return SimpleNamespace(
            id=api_key_id,
            type="app",
            token="app-test-token",
            last_used_at=None,
            created_at=None,
        )

    def fake_delete_api_key(self, resource_id: str, key_id: str, tenant_id: str, current_user: object) -> None:
        captured["delete_key"] = {
            "resource_id": resource_id,
            "api_key_id": key_id,
            "tenant_id": tenant_id,
            "current_user": current_user,
        }

    monkeypatch.setattr(AgentApiKeyListApi, "_get_api_key_list", fake_get_api_key_list)
    monkeypatch.setattr(AgentApiKeyListApi, "_create_api_key", fake_create_api_key)
    monkeypatch.setattr(AgentApiKeyApi, "_delete_api_key", fake_delete_api_key)

    with app.test_request_context(
        "/console/api/agent/00000000-0000-0000-0000-000000000001/api-enable",
        json={"enable_api": True},
    ):
        enabled = unwrap(AgentApiStatusApi.post)(AgentApiStatusApi(), "tenant-1", agent_id)
    assert enabled["enabled"] is True
    assert captured["enable"] == {"app": app_model, "enable_api": True}

    keys = unwrap(AgentApiKeyListApi.get)(AgentApiKeyListApi(), "tenant-1", agent_id)
    assert keys == {"data": []}
    assert captured["list_keys"] == {"resource_id": "app-1", "tenant_id": "tenant-1"}

    created, status = unwrap(AgentApiKeyListApi.post)(AgentApiKeyListApi(), "tenant-1", agent_id)
    assert status == 201
    assert created["id"] == api_key_id
    assert created["token"] == "app-test-token"
    assert captured["create_key"] == {"resource_id": "app-1", "tenant_id": "tenant-1"}

    current_user = SimpleNamespace(id="account-1", is_admin_or_owner=True)
    deleted, delete_status = unwrap(AgentApiKeyApi.delete)(
        AgentApiKeyApi(),
        "tenant-1",
        current_user,
        agent_id,
        api_key_id,
    )
    assert (deleted, delete_status) == ("", 204)
    assert captured["delete_key"] == {
        "resource_id": "app-1",
        "api_key_id": api_key_id,
        "tenant_id": "tenant-1",
        "current_user": current_user,
    }


def test_agent_app_update_allows_empty_role(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
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
        lambda _self, **kwargs: SimpleNamespace(
            id=agent_id,
            app_id="app-1",
            backing_app_id=None,
            role="",
            debug_conversation_id="debug-conversation-detail",
            active_config_snapshot_id=None,
        ),
    )
    monkeypatch.setattr(
        roster_controller.AgentRosterService,
        "get_or_create_agent_app_debug_conversation_id",
        lambda _self, **kwargs: "debug-conversation-detail",
    )
    monkeypatch.setattr(
        roster_controller.AgentRosterService,
        "count_agent_app_debug_conversation_messages",
        lambda _self, **kwargs: 0,
    )
    monkeypatch.setattr(
        roster_controller.AgentRosterService,
        "active_config_is_published",
        lambda _self, **kwargs: False,
    )
    monkeypatch.setattr(
        roster_controller.FeatureService,
        "get_system_features",
        lambda: SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False)),
    )

    class FakeAppService:
        def get_app(self, app_obj: object) -> object:
            return app_obj

        def update_app(self, app_obj: object, args: dict[str, object]) -> object:
            captured["update"] = {"app": app_obj, "args": args}
            return _app_detail_obj(id="app-1", name=args["name"], bound_agent_id=agent_id)

    monkeypatch.setattr(roster_controller, "AppService", FakeAppService)

    with app.test_request_context(
        "/console/api/agent/00000000-0000-0000-0000-000000000001",
        json={"name": "Renamed", "description": "", "role": "", "icon_type": "emoji", "icon": "R"},
    ):
        updated = unwrap(AgentAppApi.put)(AgentAppApi(), "tenant-1", SimpleNamespace(id="account-1"), agent_id)

    assert updated["role"] == ""
    update_call = cast(dict[str, object], captured["update"])
    assert cast(dict[str, object], update_call["args"])["role"] == ""


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
    captured_restore: dict[str, object] = {}

    def restore_agent_version(_self, **kwargs):
        captured_restore.update(kwargs)
        return {"result": "success", "active_config_snapshot_id": kwargs["version_id"]}

    monkeypatch.setattr(roster_controller.AgentRosterService, "restore_agent_version", restore_agent_version)

    assert (
        unwrap(AgentRosterVersionsApi.get)(AgentRosterVersionsApi(), "tenant-1", agent_id)["data"][0]["id"]
        == "version-1"
    )
    version_detail = unwrap(AgentRosterVersionDetailApi.get)(
        AgentRosterVersionDetailApi(), "tenant-1", agent_id, version_id
    )
    assert version_detail["id"] == version_id
    assert version_detail["agent_id"] == agent_id
    restored = unwrap(AgentRosterVersionRestoreApi.post)(
        AgentRosterVersionRestoreApi(), "tenant-1", SimpleNamespace(id="account-1"), agent_id, version_id
    )
    assert restored == {
        "result": "success",
        "active_config_snapshot_id": version_id,
        "draft_config_id": None,
        "restored_version_id": None,
    }
    assert captured_restore == {
        "tenant_id": "tenant-1",
        "agent_id": agent_id,
        "version_id": version_id,
        "account_id": "account-1",
    }


def test_agent_observability_routes_resolve_app_from_agent_id(
    app: Flask, monkeypatch: pytest.MonkeyPatch, account_id: str
) -> None:
    agent_id = "00000000-0000-0000-0000-000000000001"
    app_model = SimpleNamespace(id="app-1")
    captured: dict[str, object] = {}

    class FakeObservabilityService:
        def list_logs(self, *, app, agent_id, params):
            captured["logs"] = {"app": app, "agent_id": agent_id, "params": params}
            return {
                "data": [
                    {
                        "conversation_id": "conversation-1",
                        "id": "conversation-1",
                        "title": "Debug",
                        "end_user_id": "end-user-1",
                        "message_count": 2,
                        "user_rate": None,
                        "operation_rate": None,
                        "unread": True,
                        "source": {
                            "id": "webapp:app-1",
                            "type": "webapp",
                            "app_id": "app-1",
                            "app_name": "Iris",
                            "app_icon_type": "emoji",
                            "app_icon": "robot",
                            "app_icon_background": "#fff",
                            "workflow_id": None,
                            "workflow_version": None,
                            "node_id": None,
                        },
                        "status": "success",
                        "created_at": 1,
                        "updated_at": 2,
                    }
                ],
                "page": 2,
                "limit": 5,
                "total": 6,
                "has_more": False,
            }

        def list_log_messages(self, *, app, agent_id, conversation_id, params):
            captured["messages"] = {
                "app": app,
                "agent_id": agent_id,
                "conversation_id": conversation_id,
                "params": params,
            }
            return {
                "data": [
                    {
                        "id": "message-1",
                        "message_id": "message-1",
                        "conversation_id": "conversation-1",
                        "query": "hello",
                        "answer": "hi",
                        "status": "success",
                        "error": None,
                        "from_end_user_id": None,
                        "from_account_id": account_id,
                        "message_tokens": 1,
                        "answer_tokens": 2,
                        "total_tokens": 3,
                        "total_price": "0",
                        "currency": "USD",
                        "latency": 1.2,
                        "created_at": 1,
                        "updated_at": 2,
                    }
                ],
                "page": 1,
                "limit": 20,
                "total": 1,
                "has_more": False,
            }

        def list_log_sources(self, *, app, agent_id):
            captured["sources"] = {"app": app, "agent_id": agent_id}
            return {
                "data": [
                    {
                        "id": "webapp:app-1",
                        "type": "webapp",
                        "app_id": "app-1",
                        "app_name": "Iris",
                        "app_icon_type": "emoji",
                        "app_icon": "robot",
                        "app_icon_background": "#fff",
                        "workflow_id": None,
                        "workflow_version": None,
                        "node_id": None,
                    }
                ],
                "groups": [{"type": "webapp", "label": "WEBAPP", "sources": []}],
            }

        def get_statistics_summary(self, *, app, agent_id, params):
            captured["statistics"] = {"app": app, "agent_id": agent_id, "params": params}
            return {
                "source": "all",
                "summary": {
                    "total_messages": 1,
                    "total_conversations": 1,
                    "total_end_users": 1,
                    "total_tokens": 3,
                    "total_price": "0",
                    "currency": "USD",
                    "average_session_interactions": 1,
                    "average_response_time": 1200,
                    "tokens_per_second": 2,
                    "user_satisfaction_rate": 100,
                },
                "charts": {
                    "daily_messages": [{"date": "2026-06-17", "message_count": 1}],
                    "daily_conversations": [{"date": "2026-06-17", "conversation_count": 1}],
                    "daily_end_users": [{"date": "2026-06-17", "terminal_count": 1}],
                    "token_usage": [{"date": "2026-06-17", "token_count": 3, "total_price": "0", "currency": "USD"}],
                    "average_session_interactions": [{"date": "2026-06-17", "interactions": 1}],
                    "average_response_time": [{"date": "2026-06-17", "latency": 1200}],
                    "tokens_per_second": [{"date": "2026-06-17", "tps": 2}],
                    "user_satisfaction_rate": [{"date": "2026-06-17", "rate": 100}],
                },
            }

    monkeypatch.setattr(roster_controller, "resolve_agent_runtime_app_model", lambda **kwargs: app_model)
    monkeypatch.setattr(roster_controller, "_agent_observability_service", lambda: FakeObservabilityService())

    account = SimpleNamespace(id=account_id, timezone="UTC")
    with app.test_request_context(
        "/console/api/agent/00000000-0000-0000-0000-000000000001/logs"
        "?page=2&limit=5&keyword=hello&statuses=success&statuses=failed&sources=webapp:app-1"
        "&sources=workflow:app-2:workflow-1:v1:node-1&sort_by=created_at&sort_order=asc"
    ):
        logs = unwrap(AgentLogsApi.get)(AgentLogsApi(), "tenant-1", account, agent_id)

    assert logs["data"][0]["id"] == "conversation-1"
    assert logs["data"][0]["source"]["id"] == "webapp:app-1"
    logs_call = cast(dict[str, object], captured["logs"])
    assert logs_call["app"] is app_model
    assert logs_call["agent_id"] == agent_id
    logs_params = cast(Any, logs_call["params"])
    assert logs_params.page == 2
    assert logs_params.limit == 5
    assert logs_params.keyword == "hello"
    assert logs_params.statuses == ("success", "failed")
    assert logs_params.sources == ("webapp:app-1", "workflow:app-2:workflow-1:v1:node-1")
    assert logs_params.sort_by == "created_at"
    assert logs_params.sort_order == "asc"

    with app.test_request_context(
        "/console/api/agent/00000000-0000-0000-0000-000000000001/logs/00000000-0000-0000-0000-000000000002/messages"
    ):
        messages = unwrap(AgentLogMessagesApi.get)(
            AgentLogMessagesApi(),
            "tenant-1",
            account,
            agent_id,
            "00000000-0000-0000-0000-000000000002",
        )

    assert messages["data"][0]["id"] == "message-1"
    messages_call = cast(dict[str, object], captured["messages"])
    assert messages_call["app"] is app_model
    assert messages_call["agent_id"] == agent_id
    assert messages_call["conversation_id"] == "00000000-0000-0000-0000-000000000002"
    messages_params = cast(Any, messages_call["params"])
    assert messages_params.sources == ()
    assert messages_params.statuses == ()

    with app.test_request_context("/console/api/agent/00000000-0000-0000-0000-000000000001/log-sources"):
        sources = unwrap(AgentLogSourcesApi.get)(AgentLogSourcesApi(), "tenant-1", account, agent_id)

    assert sources["data"][0]["id"] == "webapp:app-1"
    sources_call = cast(dict[str, object], captured["sources"])
    assert sources_call["app"] is app_model
    assert sources_call["agent_id"] == agent_id

    with app.test_request_context(
        "/console/api/agent/00000000-0000-0000-0000-000000000001/statistics/summary?source=api"
    ):
        statistics = unwrap(AgentStatisticsSummaryApi.get)(AgentStatisticsSummaryApi(), "tenant-1", account, agent_id)

    assert statistics["summary"]["total_messages"] == 1
    stats_call = cast(dict[str, object], captured["statistics"])
    assert stats_call["app"] is app_model
    assert stats_call["agent_id"] == agent_id
    stats_params = cast(Any, stats_call["params"])
    assert stats_params.source == "api"
    assert stats_params.timezone == "UTC"


def test_workflow_composer_get_put_validate_candidates_impact_and_save(
    app: Flask, monkeypatch: pytest.MonkeyPatch, account_id: str
) -> None:
    app_model = SimpleNamespace(id="app-1")
    payload = {
        "variant": ComposerVariant.WORKFLOW.value,
        "save_strategy": ComposerSaveStrategy.NODE_JOB_ONLY.value,
        "binding": {"binding_type": "roster_agent", "current_snapshot_id": "version-1"},
    }
    captured_load: dict[str, object] = {}
    monkeypatch.setattr(
        composer_controller.AgentComposerService,
        "load_workflow_composer",
        lambda **kwargs: captured_load.update(kwargs) or _workflow_composer_response(node_id=kwargs["node_id"]),
    )
    monkeypatch.setattr(
        composer_controller.AgentComposerService,
        "save_workflow_composer",
        lambda **kwargs: _workflow_composer_response(save_options=[kwargs["payload"].save_strategy.value]),
    )
    monkeypatch.setattr(composer_controller.ComposerConfigValidator, "validate_publish_payload", lambda payload: None)
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

    with app.test_request_context("?snapshot_id=preview-version"):
        workflow_state = unwrap(WorkflowAgentComposerApi.get)(
            WorkflowAgentComposerApi(), "tenant-1", account_id, app_model, "node-1"
        )
    assert workflow_state["node_id"] == "node-1"
    assert captured_load["account_id"] == account_id
    assert captured_load["snapshot_id"] == "preview-version"
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


def test_workflow_composer_copy_from_roster(app: Flask, monkeypatch: pytest.MonkeyPatch, account_id: str) -> None:
    app_model = SimpleNamespace(id="app-1")
    captured: dict[str, object] = {}

    def fake_copy_from_roster(**kwargs):
        captured.update(kwargs)
        return _workflow_composer_response(
            binding={
                "id": "binding-1",
                "binding_type": "inline_agent",
                "agent_id": "inline-agent-1",
                "current_snapshot_id": "inline-version-1",
                "workflow_id": "workflow-1",
                "node_id": kwargs["node_id"],
            },
            agent={
                "id": "inline-agent-1",
                "name": "Nadia",
                "description": "",
                "scope": "workflow_only",
                "status": "active",
            },
            active_config_snapshot={"id": "inline-version-1", "version": 1},
        )

    monkeypatch.setattr(
        composer_controller.AgentComposerService, "copy_workflow_composer_from_roster", fake_copy_from_roster
    )

    with app.test_request_context(
        json={
            "source_agent_id": "roster-agent-1",
            "source_snapshot_id": "roster-version-1",
            "idempotency_key": "copy-1",
        }
    ):
        result = unwrap(WorkflowAgentComposerCopyFromRosterApi.post)(
            WorkflowAgentComposerCopyFromRosterApi(), "tenant-1", account_id, app_model, "node-1"
        )

    assert result["binding"]["binding_type"] == "inline_agent"
    assert captured == {
        "tenant_id": "tenant-1",
        "app_id": "app-1",
        "node_id": "node-1",
        "account_id": account_id,
        "source_agent_id": "roster-agent-1",
        "source_snapshot_id": "roster-version-1",
        "idempotency_key": "copy-1",
    }


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

    def load_agent_composer(**kwargs: object) -> dict:
        captured["load"] = kwargs
        return _agent_app_composer_response()

    def save_agent_composer(**kwargs: object) -> dict:
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
        "load_agent_composer",
        load_agent_composer,
    )
    monkeypatch.setattr(
        composer_controller.AgentComposerService,
        "save_agent_composer",
        save_agent_composer,
    )
    monkeypatch.setattr(composer_controller.ComposerConfigValidator, "validate_publish_payload", lambda payload: None)
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
    assert cast(dict[str, object], captured["load"])["agent_id"] == agent_id

    with app.test_request_context(json=payload):
        assert (
            unwrap(AgentComposerApi.put)(AgentComposerApi(), "tenant-1", account_id, agent_id)["variant"] == "agent_app"
        )
        assert cast(dict[str, object], captured["save"])["agent_id"] == agent_id
        assert unwrap(AgentComposerValidateApi.post)(AgentComposerValidateApi(), "tenant-1", agent_id) == {
            "result": "success",
            "errors": [],
            "warnings": [],
            "knowledge_retrieval_placeholder": [],
        }
        assert cast(dict[str, object], captured["validate"])["agent_id"] == agent_id

    candidates = unwrap(AgentComposerCandidatesApi.get)(AgentComposerCandidatesApi(), "tenant-1", account_id, agent_id)
    assert candidates["variant"] == "agent_app"
    assert cast(dict[str, object], captured["candidates"])["agent_id"] == agent_id


def test_agent_chat_generate_and_stop_routes_resolve_app_from_agent_id(
    app: Flask, monkeypatch: pytest.MonkeyPatch, account_id: str
) -> None:
    agent_id = "00000000-0000-0000-0000-000000000001"
    app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1", mode="agent")
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

    monkeypatch.setattr(completion_controller, "resolve_agent_runtime_app_model", resolve_agent_app_model)
    monkeypatch.setattr(completion_controller, "_create_chat_message", create_chat_message)
    monkeypatch.setattr(completion_controller, "_stop_chat_message", stop_chat_message)

    session = Mock()

    with app.test_request_context(json={"inputs": {}, "query": "hello"}):
        assert unwrap(AgentChatMessageApi.post)(
            AgentChatMessageApi(), session, "tenant-1", SimpleNamespace(id=account_id), agent_id
        ) == {"result": "generated"}

    assert cast(dict[str, object], captured["resolve"]) == {"tenant_id": "tenant-1", "agent_id": agent_id}
    create_call = cast(dict[str, object], captured["create"])
    assert create_call["session"] is session
    assert create_call["app_model"] is app_model
    assert cast(SimpleNamespace, create_call["current_user"]).id == account_id

    assert unwrap(AgentChatMessageStopApi.post)(
        AgentChatMessageStopApi(), "tenant-1", account_id, agent_id, "task-1"
    ) == ({"result": "success"}, 200)
    stop_call = cast(dict[str, object], captured["stop"])
    assert stop_call == {"current_user_id": account_id, "app_model": app_model, "task_id": "task-1"}


def test_agent_chat_stream_preflight_raises_first_error_event() -> None:
    class ClosableStream:
        def __init__(self) -> None:
            self.closed = False
            self._chunks = iter(
                [
                    "event: ping\n\n",
                    (
                        'data: {"event":"error","message":"Incorrect API key provided",'
                        '"code":"completion_request_error","status":400}\n\n'
                    ),
                ]
            )

        def __iter__(self):
            return self

        def __next__(self) -> str:
            return next(self._chunks)

        def close(self) -> None:
            self.closed = True

    stream = ClosableStream()

    with pytest.raises(CompletionRequestError) as exc_info:
        completion_controller._raise_agent_stream_error_before_response(stream)

    assert "Incorrect API key provided" in exc_info.value.description
    assert stream.closed is True


def test_agent_chat_stream_preflight_preserves_first_normal_event() -> None:
    stream = iter(
        [
            "event: ping\n\n",
            'data: {"event":"message","answer":"hello"}\n\n',
            'data: {"event":"message_end"}\n\n',
        ]
    )

    wrapped = completion_controller._raise_agent_stream_error_before_response(stream)

    assert list(wrapped) == [
        "event: ping\n\n",
        'data: {"event":"message","answer":"hello"}\n\n',
        'data: {"event":"message_end"}\n\n',
    ]


def test_agent_build_chat_finalize_route_resolves_app_from_agent_id(
    app: Flask, monkeypatch: pytest.MonkeyPatch, account_id: str
) -> None:
    agent_id = "00000000-0000-0000-0000-000000000001"
    app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1", mode="agent")
    captured: dict[str, object] = {}

    def resolve_agent_app_model(**kwargs: object) -> object:
        captured["resolve"] = kwargs
        return app_model

    def create_finalization_message(**kwargs: object) -> dict[str, object]:
        captured["finalize"] = kwargs
        return {"result": "generated"}

    monkeypatch.setattr(completion_controller, "resolve_agent_runtime_app_model", resolve_agent_app_model)
    monkeypatch.setattr(completion_controller, "_create_build_chat_finalization_message", create_finalization_message)

    session = Mock()

    with app.test_request_context():
        assert unwrap(AgentBuildChatFinalizeApi.post)(
            AgentBuildChatFinalizeApi(), session, "tenant-1", SimpleNamespace(id=account_id), agent_id
        ) == {"result": "generated"}

    assert cast(dict[str, object], captured["resolve"]) == {"tenant_id": "tenant-1", "agent_id": agent_id}
    finalize_call = cast(dict[str, object], captured["finalize"])
    assert finalize_call["session"] is session
    assert finalize_call["app_model"] is app_model
    assert finalize_call["current_tenant_id"] == "tenant-1"
    assert finalize_call["agent_id"] == agent_id
    assert cast(SimpleNamespace, finalize_call["current_user"]).id == account_id


def test_build_chat_finalization_helper_forces_debug_build_and_push_prompt(
    app: Flask, monkeypatch: pytest.MonkeyPatch, account_id: str
) -> None:
    app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1", mode="agent")
    captured: dict[str, object] = {}

    def resolve_debug_conversation(**kwargs: object) -> str:
        captured["resolve_debug_conversation"] = kwargs
        return "debug-conversation-1"

    def generate(**kwargs: object) -> object:
        captured["generate"] = kwargs
        return iter(
            [
                "event: ping\n\n",
                'data: {"event":"message","answer":"working"}\n\n',
                'data: {"event":"message_end"}\n\n',
            ]
        )

    monkeypatch.setattr(
        completion_controller,
        "_resolve_current_user_agent_debug_conversation_id",
        resolve_debug_conversation,
    )
    monkeypatch.setattr(completion_controller.AppGenerateService, "generate", generate)

    with app.test_request_context(headers={"X-Trace-Id": "trace-1"}):
        result = completion_controller._create_build_chat_finalization_message(
            current_tenant_id="tenant-1",
            current_user=SimpleNamespace(id=account_id),
            app_model=app_model,
            agent_id="agent-1",
            session=Mock(),
        )

    assert result == ({"result": "success"}, 200)
    assert captured["resolve_debug_conversation"] == {
        "current_tenant_id": "tenant-1",
        "current_user": SimpleNamespace(id=account_id),
        "app_model": app_model,
        "agent_id": "agent-1",
    }
    generate_call = cast(dict[str, object], captured["generate"])
    assert generate_call["app_model"] is app_model
    assert generate_call["streaming"] is True
    args = cast(dict[str, object], generate_call["args"])
    assert args["draft_type"] == "debug_build"
    assert args["response_mode"] == "streaming"
    assert args["conversation_id"] == "debug-conversation-1"
    assert args["inputs"] == {}
    assert args["auto_generate_name"] is False
    assert args["external_trace_id"] == "trace-1"


def test_drain_streaming_generate_response_returns_on_message_end() -> None:
    class ClosableResponse:
        def __init__(self) -> None:
            self._chunks = iter(
                [
                    "event: ping\n\n",
                    'data: {"event":"message","answer":"working"}\n\n',
                    'data: {"event":"message_end","message_id":"msg-1"}\n\n',
                ]
            )
            self.closed = False

        def __iter__(self):
            return self

        def __next__(self) -> str:
            return next(self._chunks)

        def close(self) -> None:
            self.closed = True

    response = ClosableResponse()

    assert completion_controller._drain_streaming_generate_response(response) is None
    assert response.closed is True


def test_drain_streaming_generate_response_maps_error_event() -> None:
    response = iter(['data: {"event":"error","message":"backend failed"}\n\n'])

    with pytest.raises(CompletionRequestError, match="backend failed"):
        completion_controller._drain_streaming_generate_response(response)


def test_drain_streaming_generate_response_raises_when_stream_ends_early() -> None:
    response = iter(['data: {"event":"message","answer":"working"}\n\n'])

    with pytest.raises(CompletionRequestError, match="did not complete"):
        completion_controller._drain_streaming_generate_response(response)


def test_agent_chat_helper_forces_agent_streaming_and_external_trace(
    app: Flask, monkeypatch: pytest.MonkeyPatch, account_id: str
) -> None:
    app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1", mode="agent")
    current_user = SimpleNamespace(id=account_id)
    captured: dict[str, object] = {}

    def generate(**kwargs: object) -> dict[str, object]:
        captured.update(kwargs)
        return {"answer": "ok"}

    monkeypatch.setattr(completion_controller.AppGenerateService, "generate", generate)
    monkeypatch.setattr(
        completion_controller,
        "_resolve_current_user_agent_debug_conversation_id",
        lambda **kwargs: "debug-conversation-1",
    )
    monkeypatch.setattr(
        completion_controller.helper,
        "compact_generate_response",
        lambda response: {"response": response},
    )

    with app.test_request_context(
        json={"inputs": {}, "query": "hello", "response_mode": "streaming"},
        headers={"X-Trace-Id": "trace-1"},
    ):
        result = completion_controller._create_chat_message(
            current_user=current_user,
            app_model=app_model,
            session=Mock(),
        )

    assert result == {"response": {"answer": "ok"}}
    assert captured["app_model"] is app_model
    assert captured["user"] is current_user
    assert captured["streaming"] is True
    args = cast(dict[str, object], captured["args"])
    assert args["response_mode"] == "streaming"
    assert args["conversation_id"] == "debug-conversation-1"
    assert args["auto_generate_name"] is False
    assert args["external_trace_id"] == "trace-1"


def test_agent_chat_helper_rejects_foreign_debug_conversation(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    account_id: str,
) -> None:
    app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1", mode="agent")

    monkeypatch.setattr(
        completion_controller,
        "_resolve_current_user_agent_debug_conversation_id",
        lambda **kwargs: "owned-conversation",
    )

    with app.test_request_context(
        json={
            "inputs": {},
            "query": "hello",
            "response_mode": "streaming",
            "conversation_id": "00000000-0000-0000-0000-000000000001",
        }
    ):
        with pytest.raises(NotFound):
            completion_controller._create_chat_message(
                current_tenant_id="tenant-1",
                current_user=SimpleNamespace(id=account_id),
                app_model=app_model,
                agent_id="agent-1",
                session=Mock(),
            )


def test_resolve_current_user_agent_debug_conversation_uses_agent_or_backing_app(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, object]] = []

    class FakeRosterService:
        def __init__(self, session: object) -> None:
            calls.append({"session": session})

        def get_or_create_agent_app_debug_conversation_id(self, **kwargs: object) -> str:
            calls.append({"get_or_create": kwargs})
            return f"debug-{kwargs['agent_id']}"

        def get_app_backing_agent(self, **kwargs: object) -> object:
            calls.append({"get_app_backing_agent": kwargs})
            return SimpleNamespace(id="backing-agent")

    monkeypatch.setattr(completion_controller, "AgentRosterService", FakeRosterService)
    monkeypatch.setattr(completion_controller, "db", SimpleNamespace(session="session-1"))

    explicit_id = completion_controller._resolve_current_user_agent_debug_conversation_id(
        current_tenant_id="tenant-1",
        current_user=SimpleNamespace(id="account-1"),
        app_model=SimpleNamespace(id="app-1"),
        agent_id="agent-1",
    )
    fallback_id = completion_controller._resolve_current_user_agent_debug_conversation_id(
        current_tenant_id="tenant-1",
        current_user=SimpleNamespace(id="account-1"),
        app_model=SimpleNamespace(id="app-1"),
        agent_id=None,
    )

    assert explicit_id == "debug-agent-1"
    assert fallback_id == "debug-backing-agent"
    assert calls[1] == {"get_or_create": {"tenant_id": "tenant-1", "agent_id": "agent-1", "account_id": "account-1"}}
    assert calls[3] == {"get_app_backing_agent": {"tenant_id": "tenant-1", "app_id": "app-1"}}
    assert calls[4] == {
        "get_or_create": {"tenant_id": "tenant-1", "agent_id": "backing-agent", "account_id": "account-1"}
    }


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
                session=Mock(),
            )


def test_agent_chat_message_routes_resolve_app_from_agent_id(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    agent_id = "00000000-0000-0000-0000-000000000001"
    message_id = "00000000-0000-0000-0000-000000000002"
    app_model = SimpleNamespace(id="app-1", mode="agent")
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

    monkeypatch.setattr(message_controller, "resolve_agent_runtime_app_model", resolve_agent_app_model)
    monkeypatch.setattr(message_controller, "_list_chat_messages", list_chat_messages)
    monkeypatch.setattr(message_controller, "_update_message_feedback", update_message_feedback)
    monkeypatch.setattr(message_controller, "_get_message_suggested_questions", get_message_suggested_questions)
    monkeypatch.setattr(message_controller, "_get_message_detail", get_message_detail)

    assert unwrap(AgentChatMessageListApi.get)(AgentChatMessageListApi(), "tenant-1", current_user, agent_id) == {
        "data": []
    }
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
        result = message_controller._list_chat_messages(app_model=SimpleNamespace(id="app-1", mode="chat"))

    assert result == {"data": [older_message_id], "limit": 1, "has_more": True}


def test_list_agent_chat_messages_uses_current_user_conversation(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conversation_id = "00000000-0000-0000-0000-000000000010"
    message_id = "00000000-0000-0000-0000-000000000011"
    conversation = SimpleNamespace(id=conversation_id)
    message = SimpleNamespace(id=message_id, created_at=1)
    current_user = SimpleNamespace(id="account-1")
    app_model = SimpleNamespace(id="app-1", mode="agent")
    captured: dict[str, object] = {}
    session = SimpleNamespace(
        scalar=lambda _stmt: False,
        scalars=lambda _stmt: SimpleNamespace(all=lambda: [message]),
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

    def get_conversation(**kwargs: object) -> object:
        captured.update(kwargs)
        return conversation

    monkeypatch.setattr(message_controller.ConversationService, "get_conversation", get_conversation)
    monkeypatch.setattr(message_controller, "db", SimpleNamespace(session=session))
    monkeypatch.setattr(message_controller, "attach_message_extra_contents", lambda messages: None)
    monkeypatch.setattr(message_controller, "MessageInfiniteScrollPaginationResponse", FakeMessagePaginationResponse)

    with app.test_request_context(f"/console/api/agent/agent-1/chat-messages?conversation_id={conversation_id}"):
        result = message_controller._list_chat_messages(app_model=app_model, current_user=current_user)

    assert result == {"data": [message_id], "limit": 20, "has_more": False}
    assert captured == {"app_model": app_model, "conversation_id": conversation_id, "user": current_user}


def test_list_agent_chat_messages_rejects_foreign_conversation(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conversation_id = "00000000-0000-0000-0000-000000000010"
    monkeypatch.setattr(
        message_controller.ConversationService,
        "get_conversation",
        lambda **kwargs: (_ for _ in ()).throw(message_controller.ConversationNotExistsError()),
    )

    with app.test_request_context(f"/console/api/agent/agent-1/chat-messages?conversation_id={conversation_id}"):
        with pytest.raises(NotFound):
            message_controller._list_chat_messages(
                app_model=SimpleNamespace(id="app-1", mode="agent"),
                current_user=SimpleNamespace(id="account-1"),
            )


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
