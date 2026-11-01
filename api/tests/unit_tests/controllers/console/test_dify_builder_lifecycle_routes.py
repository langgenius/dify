"""Lifecycle wire contracts use explicit confirmation and no graph revision."""

import json
from datetime import UTC, datetime
from inspect import unwrap
from uuid import uuid4

import pytest
from flask import Flask
from pydantic import ValidationError

from constants import COOKIE_NAME_CSRF_TOKEN, HEADER_NAME_CSRF_TOKEN
from controllers.console import dify_builder as routes
from controllers.console import dify_builder_fields as schemas
from core.dify_builder.models import Actor, DifyBuilderContext, EntryMode, Session
from core.dify_builder.state import PcState
from libs.passport import PassportService
from libs.token import _real_cookie_name, generate_csrf_token
from models.account import Account, TenantAccountJoin, TenantAccountRole
from services.dify_builder.fix_intent_repository import SqlFixIntentRepository
from services.dify_builder.repository import SqlDifyBuilderRepository
from tests.unit_tests.controllers.console.test_dify_builder_routes import (
    _SESSION_ID,
    _account,
    _RequestSqlWorld,
    _route_service,
)

pytest_plugins = ["tests.unit_tests.controllers.console.test_dify_builder_routes"]


def test_clear_payload_requires_explicit_confirmation_and_rejects_graph_revision() -> None:
    assert hasattr(schemas, "DifyBuilderClearConversationPayload")
    payload_type = schemas.DifyBuilderClearConversationPayload
    valid = {"base_version": 3, "client_action_id": "clear-3", "confirmed": True}
    assert payload_type.model_validate(valid).confirmed is True
    for invalid in (
        {"base_version": 3, "client_action_id": "clear-3"},
        {**valid, "confirmed": False},
        {**valid, "confirmed": 1},
        {**valid, "base_version": True},
        {**valid, "base_version": 0},
        {**valid, "base_app_revision": "must-not-be-read"},
    ):
        with pytest.raises(ValidationError):
            payload_type.model_validate(invalid)


@pytest.mark.parametrize("operation", ["clear", "abandon"])
def test_lifecycle_routes_return_only_the_lifecycle_receipt(operation: str, monkeypatch: pytest.MonkeyPatch) -> None:
    assert hasattr(routes, "DifyBuilderConversationClearApi")
    assert hasattr(routes, "DifyBuilderTaskAbandonApi")
    service = _route_service()
    calls = []
    receipt: dict[str, object] = {
        "session_id": "s1",
        "version": 4,
        "last_command_id": "lifecycle-3",
        "task_id": "s1:0",
        "task_status": "abandoned",
        "settlement": "settled",
        "conversation_cleared": operation == "clear",
        "conversation_last_seq": -1,
    }

    def control(session_id: str, actor: Actor, **kwargs: object) -> dict[str, object]:
        calls.append((session_id, actor, kwargs))
        return receipt

    monkeypatch.setattr(
        service, operation + "_conversation" if operation == "clear" else "abandon_task", control, raising=False
    )
    monkeypatch.setattr(routes, "build_service", lambda: service)
    body = {"base_version": 3, "client_action_id": "lifecycle-3", "expected_task_id": "s1:0"}
    if operation == "clear":
        body["confirmed"] = True
    resource = routes.DifyBuilderConversationClearApi if operation == "clear" else routes.DifyBuilderTaskAbandonApi
    with Flask(__name__).test_request_context(json=body):
        result = unwrap(resource.post)(object(), "ten-1", _account(), "s1")
    assert result == receipt
    assert calls == [("s1", Actor(account_id="acc-1", tenant_id="ten-1"), body)]
    assert "app_revision" not in result
    assert "conversation" not in result


def test_fix_intake_payload_requires_exactly_one_failure_source() -> None:
    assert hasattr(schemas, "DifyBuilderFixIntentPayload")
    payload_type = schemas.DifyBuilderFixIntentPayload
    base = {"client_action_id": "fix-1", "base_version": 1}
    assert payload_type.model_validate({**base, "failed_run_id": "native-failed"}).failed_run_id == "native-failed"
    for invalid in (base, {**base, "failed_run_id": ""}, {**base, "origin_task_id": "forged"}):
        with pytest.raises(ValidationError):
            payload_type.model_validate(invalid)


@pytest.mark.parametrize("operation", ["fix", "dismiss_fix", "stop_and_switch_fix"])
def test_fix_control_get_uses_owner_and_returns_only_correlated_receipt(
    operation: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = _route_service()
    calls = []
    receipt: dict[str, object] = {
        "session_id": "s1",
        "operation": operation,
        "client_action_id": "decision-1",
        "base_version": 3,
        "fix_intent_id": "intent-1",
        "target_task_id": "s1:0",
        "status": "dismissed",
        "acknowledged": True,
    }

    def read(session_id: str, actor: Actor, **query: object) -> dict[str, object]:
        calls.append((session_id, actor, query))
        return receipt

    monkeypatch.setattr(service, "get_fix_control_receipt", read, raising=False)
    monkeypatch.setattr(routes, "build_service", lambda: service)
    query = {
        "operation": operation,
        "client_action_id": "decision-1",
        "base_version": "3",
        "fix_intent_id": "intent-1",
        "expected_task_id": "s1:0",
    }
    with Flask(__name__).test_request_context(query_string=query):
        result = unwrap(routes.DifyBuilderFixIntentsApi.get)(object(), "ten-1", _account(), "s1")
    assert result == receipt
    actor = Actor(account_id="acc-1", tenant_id="ten-1")
    expected_id = "decision-1" if operation == "fix" else routes._action_command_id("s1", actor, "decision-1")
    assert calls == [("s1", actor, {**query, "base_version": 3, "client_action_id": expected_id})]
    assert all(param["in"] == "query" for param in routes.DifyBuilderFixIntentsApi.get.__apidoc__["params"].values())
    for invalid in (
        {"operation": "dismiss_fix", "client_action_id": "x", "base_version": "1"},
        {**query, "source": "forged"},
    ):
        with pytest.raises(ValidationError):
            schemas.DifyBuilderFixControlQuery.model_validate(invalid)


@pytest.mark.parametrize("status", [400, 404, 409])
def test_fix_control_get_declares_its_existing_builder_error_body(status: int) -> None:
    assert (
        routes.DifyBuilderFixIntentsApi.get.__apidoc__["responses"][str(status)][1].name == "DifyBuilderErrorResponse"
    )


def test_real_http_action_and_fix_receipt_share_decision_namespace(request_sql_world: _RequestSqlWorld) -> None:
    """Signed Console requests traverse the real adapter, service and SQL intent owner."""
    world = request_sql_world
    service = routes.build_service()
    repo = SqlDifyBuilderRepository(world.registry.session_factory)
    intents = SqlFixIntentRepository(repo)
    service._fix_intent_repo = intents
    stored, _ = repo.get_session(_SESSION_ID)
    actor = Actor(account_id=stored.owner_account_id, tenant_id=stored.tenant_id)
    url = f"/console/api/dify-builder/sessions/{_SESSION_ID}"
    raw_intake, raw_decision = "browser-fix-intake", "browser-dismiss-action"
    prepared = world.client.post(
        url + "/fix-intents",
        json={
            "base_version": 3,
            "client_action_id": raw_intake,
            "checklist_errors": [
                {
                    "node_id": "node-1",
                    "node_type": "llm",
                    "title": "Step",
                    "messages": ["Configuration required"],
                    "unconnected": False,
                    "plugin_missing": False,
                }
            ],
        },
    )
    assert prepared.status_code == 200, prepared.get_data(as_text=True)
    intent_id = prepared.get_json()["fix_intent_id"]
    stored_intent = intents.find(actor, _SESSION_ID, raw_intake)
    assert stored_intent is not None
    assert stored_intent.id == intent_id
    intake_read = world.client.get(
        url + "/fix-intents",
        query_string={
            "operation": "fix",
            "base_version": 3,
            "client_action_id": raw_intake,
        },
    )
    assert intake_read.status_code == 200
    assert intake_read.get_json()["client_action_id"] == raw_intake
    decided = world.client.post(
        url + "/actions",
        json={
            "action_id": "confirm",
            "base_version": 3,
            "base_app_revision": "draft",
            "client_action_id": raw_decision,
            "payload": {"option_id": "dismiss_fix", "fix_intent_id": intent_id, "expected_task_id": f"{_SESSION_ID}:0"},
        },
    )
    assert decided.status_code == 200, decided.get_data(as_text=True)
    frames = [json.loads(line[6:]) for line in decided.get_data(as_text=True).splitlines() if line.startswith("data: ")]
    command_id = next(frame["data"]["command_id"] for frame in frames if frame["event"] == "command_finished")
    assert command_id != raw_decision
    assert intents.get(actor, _SESSION_ID, intent_id).decision_id == command_id
    query = {
        "operation": "dismiss_fix",
        "base_version": 3,
        "client_action_id": raw_decision,
        "fix_intent_id": intent_id,
        "expected_task_id": f"{_SESSION_ID}:0",
    }
    recovered = world.client.get(url + "/fix-intents", query_string=query)
    assert recovered.status_code == 200, recovered.get_data(as_text=True)
    assert recovered.get_json()["acknowledged"] is True
    assert recovered.get_json()["client_action_id"] == raw_decision
    assert (
        world.client.get(url + "/fix-intents", query_string={**query, "client_action_id": command_id}).status_code
        == 404
    )
    other_session = Session(
        app_id=stored.app_id,
        tenant_id=actor.tenant_id,
        owner_account_id=actor.account_id,
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_REVIEW,
    )
    repo.create_session(other_session, DifyBuilderContext(), [])
    assert (
        world.client.get(
            f"/console/api/dify-builder/sessions/{other_session.id}/fix-intents",
            query_string={**query, "base_version": 1, "expected_task_id": f"{other_session.id}:0"},
        ).status_code
        == 404
    )
    with repo._session_factory() as sql, sql.begin():
        other = Account(name="Other actor", email=f"{uuid4()}@example.test")
        sql.add(other)
        sql.flush()
        other_id = other.id
        sql.add(
            TenantAccountJoin(
                tenant_id=actor.tenant_id, account_id=other_id, role=TenantAccountRole.EDITOR, current=True
            )
        )
    access = PassportService().issue({"user_id": other_id, "exp": int(datetime.now(UTC).timestamp()) + 600})
    csrf = generate_csrf_token(other_id)
    world.client.set_cookie(_real_cookie_name(COOKIE_NAME_CSRF_TOKEN), csrf)
    world.client.environ_base["HTTP_AUTHORIZATION"] = f"Bearer {access}"
    world.client.environ_base[f"HTTP_{HEADER_NAME_CSRF_TOKEN.upper().replace('-', '_')}"] = csrf
    assert world.client.get(url + "/fix-intents", query_string=query).status_code == 404
    assert world.enqueued == []


def test_action_namespace_retains_session_actor_tenant_and_optional_id() -> None:
    actor = Actor(account_id="account-1", tenant_id="tenant-1")
    identifiers = {
        routes._action_command_id("session-1", actor, "raw-id"),
        routes._action_command_id("session-2", actor, "raw-id"),
        routes._action_command_id("session-1", Actor(account_id="account-2", tenant_id="tenant-1"), "raw-id"),
        routes._action_command_id("session-1", Actor(account_id="account-1", tenant_id="tenant-2"), "raw-id"),
    }
    assert len(identifiers) == 4
    assert "raw-id" not in identifiers
    assert routes._action_command_id("session-1", actor, None) == ""
