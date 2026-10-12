"""Unit tests for the Dify Builder console JSON and SSE routes.

The module-level route functions are deliberately undecorated, so these tests
exercise request validation, pre-stream error mapping, and stream construction
without requiring a logged-in Flask request context.
"""

import json
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from inspect import unwrap
from pathlib import Path
from types import FunctionType, SimpleNamespace
from typing import Annotated, NamedTuple, TypedDict, cast, get_args, override
from unittest.mock import MagicMock, call

import pytest
from flask import Flask, Response, g
from flask.testing import FlaskClient
from flask_restx.model import SchemaModel
from pydantic import Field, TypeAdapter, ValidationError
from sqlalchemy import Engine, create_engine, event, insert, select
from sqlalchemy.orm import Session as OrmSession
from sqlalchemy.orm import scoped_session, sessionmaker
from werkzeug.exceptions import Forbidden

import controllers.console.dify_builder as mod
import core.db.session_factory as session_factory_module
from controllers.common.rbac import RBACPermission
from controllers.common.rbac import locators as rbac_locators
from controllers.console import bp as console_bp
from controllers.console import wraps as wraps_mod
from controllers.console.dify_builder_fields import (
    DifyBuilderConfirmRealCallPayload,
    DifyBuilderExecuteRealCallPayload,
    DifyBuilderPrepareRealCallPayload,
    DifyBuilderRealCallConsentResponse,
    DifyBuilderRealCallForbiddenResponse,
    DifyBuilderRealCallRefusalReason,
    DifyBuilderRealCallRefusalResponse,
)
from core.dify_builder.contract import ConversationPage, RunStatus
from core.dify_builder.errors import BusyError, ConflictError, ModelUnavailableError, NotFoundError
from core.dify_builder.execution_policy import BuilderExecutionPolicyError
from core.dify_builder.models import (
    CONFIRMED_TOOL_ACTION,
    Action,
    Actor,
    ConversationItem,
    DifyBuilderContext,
    EntryMode,
)
from core.dify_builder.models import Session as DomainSession
from core.dify_builder.ports import Repository
from core.dify_builder.real_call_consent import ConsentReceipt, gmail_message_url
from core.dify_builder.state import PcState
from models.account import Account, AccountStatus, TenantAccountJoin, TenantAccountRole
from models.base import Base, TypeBase
from models.model import App, DifySetup
from services.dify_builder import wiring
from services.dify_builder.real_call_consent_service import BuilderRealCallConsentService
from services.dify_builder.service import DifyBuilderService, SessionView
from services.enterprise.rbac_service import RBACService
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.model_factories import make_tenant


def _session_view(session_id: str = "s1", *, run_status: RunStatus = RunStatus.PROCESSING) -> SessionView:
    return SessionView(
        session_id=session_id,
        app_id="a1",
        version=1,
        state="fix.diagnose",
        canvas_read_only=True,
        run_status=run_status,
        interrupted=False,
        conversation_last_seq=-1,
    )


def _account(account_id: str = "acc-1") -> MagicMock:
    account = MagicMock()
    account.id = account_id
    return account


def _actor() -> Actor:
    return mod._actor(_account(), "ten-1")


def _frames():
    yield f"event: message\ndata: {json.dumps({'event': 'command_started', 'data': {'session_id': 's1'}})}\n\n"


def _assert_event_stream(result) -> Response:
    assert isinstance(result, Response)
    assert result.mimetype == "text/event-stream"
    assert result.headers["Cache-Control"] == "no-cache"
    assert result.headers["X-Accel-Buffering"] == "no"
    return result


def test_actor_builds_from_current_user_and_tenant():
    actor = mod._actor(_account("acc-1"), "ten-1")
    assert actor == Actor(account_id="acc-1", tenant_id="ten-1")


def test_session_get_returns_json_state(monkeypatch):
    service = MagicMock()
    service.get_session_view.return_value = _session_view()
    monkeypatch.setattr(mod, "build_service", lambda: service)

    response = unwrap(mod.DifyBuilderSessionApi.get)(object(), "ten-1", _account(), "s1")

    assert response["session_id"] == "s1"
    assert response["conversation_last_seq"] == -1
    assert "conversation" not in response
    service.get_session_view.assert_called_once_with("s1", Actor(account_id="acc-1", tenant_id="ten-1"))


def test_session_stream_delegates_to_reconnect_stream(monkeypatch):
    stream = MagicMock(return_value=Response(_frames(), mimetype="text/event-stream", headers=mod._SSE_HEADERS))
    monkeypatch.setattr(mod, "_stream", stream)

    response = unwrap(mod.DifyBuilderSessionStreamApi.get)(object(), "ten-1", _account(), "s1")

    _assert_event_stream(response)
    stream.assert_called_once_with("s1", Actor(account_id="acc-1", tenant_id="ten-1"))


def test_conversation_get_validates_query_and_returns_json_page(monkeypatch):
    service = MagicMock()
    service.get_conversation_page.return_value = ConversationPage(
        data=[ConversationItem(seq=2, kind="notice", payload={"text": "hi"}, at_version=2)],
        has_more=True,
        first_seq=2,
        last_seq=2,
    )
    monkeypatch.setattr(mod, "build_service", lambda: service)

    response = mod._conversation("s1", {"before_seq": "3", "limit": "10"}, _actor())

    assert response == {
        "data": [{"seq": 2, "at_version": 2, "kind": "notice", "payload": {"text": "hi", "tone": "neutral"}}],
        "has_more": True,
        "first_seq": 2,
        "last_seq": 2,
    }
    service.get_conversation_page.assert_called_once_with(
        "s1",
        _actor(),
        limit=10,
        before_seq=3,
        after_seq=None,
    )


def test_conversation_get_rejects_competing_cursors(monkeypatch):
    service = MagicMock()
    monkeypatch.setattr(mod, "build_service", lambda: service)

    assert mod._conversation("s1", {"before_seq": "3", "after_seq": "1"}, _actor()) == (
        {"code": "bad_request"},
        400,
    )
    service.get_conversation_page.assert_not_called()


@pytest.mark.parametrize(
    ("payload", "method_name", "expected_kwargs"),
    [
        (
            {"scenario": "build", "app_id": "a1", "goal_text": "Build it"},
            "create_build_session_stream",
            {"app_id": "a1", "goal_text": "Build it", "model_config": None, "derive_app_name": False},
        ),
        (
            {"scenario": "edit", "app_id": "a1", "goal_text": "Tighten risk"},
            "create_edit_session_stream",
            {"app_id": "a1", "goal_text": "Tighten risk", "model_config": None},
        ),
        (
            {"scenario": "fix", "app_id": "a1", "failed_run_id": "TR-1"},
            "create_fix_session_stream",
            {
                "app_id": "a1",
                "failed_run_id": "TR-1",
                "model_config": None,
            },
        ),
        (
            {
                "scenario": "fix",
                "app_id": "a1",
                "checklist_errors": [
                    {
                        "node_id": "node-1",
                        "node_type": "llm",
                        "title": "Missing model",
                        "messages": ["Select a model"],
                        "unconnected": False,
                        "plugin_missing": False,
                    }
                ],
            },
            "create_fix_session_stream",
            {
                "app_id": "a1",
                "failed_run_id": None,
                "checklist_errors": [
                    {
                        "node_id": "node-1",
                        "node_type": "llm",
                        "title": "Missing model",
                        "messages": ["Select a model"],
                        "unconnected": False,
                        "plugin_missing": False,
                    }
                ],
                "model_config": None,
            },
        ),
    ],
)
def test_create_always_calls_streaming_service(monkeypatch, payload, method_name, expected_kwargs):
    service = MagicMock()
    getattr(service, method_name).return_value = _frames()
    monkeypatch.setattr(mod, "build_service", lambda: service)
    actor = _actor()

    response = _assert_event_stream(mod._create(payload, actor))

    assert b'"event": "command_started"' in response.get_data()
    called = getattr(service, method_name).call_args
    assert called.kwargs == {**expected_kwargs, "actor": actor}
    service.create_build_session.assert_not_called()
    service.create_edit_session.assert_not_called()
    service.create_fix_session.assert_not_called()


def test_create_serializes_model_config_for_service(monkeypatch):
    service = MagicMock()
    service.create_build_session_stream.return_value = _frames()
    monkeypatch.setattr(mod, "build_service", lambda: service)

    response = mod._create(
        {
            "scenario": "build",
            "app_id": "a1",
            "goal_text": "Build it",
            "model_config": {
                "provider": "langgenius/openai/openai",
                "name": "gpt-4o-mini",
                "mode": "chat",
                "completion_params": {"temperature": 0.2},
            },
        },
        _actor(),
    )

    _assert_event_stream(response)
    assert service.create_build_session_stream.call_args.kwargs["model_config"] == {
        "provider": "langgenius/openai/openai",
        "name": "gpt-4o-mini",
        "mode": "chat",
        "completion_params": {"temperature": 0.2},
    }


@pytest.mark.parametrize(
    "payload",
    [
        None,
        {"app_id": "a1", "failed_run_id": "TR-1"},
        {"scenario": "unknown", "app_id": "a1"},
        {"scenario": "fix", "app_id": "a1"},
        {"scenario": "fix", "app_id": "a1", "checklist_errors": []},
        {"scenario": "build", "app_id": "a1", "goal_text": "  "},
        {"scenario": "edit", "app_id": "a1", "goal_text": 1},
        {"scenario": "build", "app_id": "a1", "goal_text": "goal", "model_config": []},
        {
            "scenario": "build",
            "app_id": "a1",
            "goal_text": "goal",
            "response_mode": "streaming",
        },
    ],
)
def test_create_rejects_malformed_or_legacy_payload_before_service(monkeypatch, payload):
    service = MagicMock()
    monkeypatch.setattr(mod, "build_service", lambda: service)

    assert mod._create(payload, _actor()) == ({"code": "bad_request"}, 400)
    assert not service.mock_calls


def test_create_maps_pre_stream_error(monkeypatch):
    service = MagicMock()
    service.create_fix_session_stream.side_effect = ConflictError("stale")
    monkeypatch.setattr(mod, "build_service", lambda: service)

    result = mod._create({"scenario": "fix", "app_id": "a1", "failed_run_id": "TR-1"}, _actor())

    assert result == ({"code": "conflict"}, 409)


def test_create_returns_recoverable_model_error_before_starting_stream(monkeypatch):
    service = MagicMock()
    service.create_build_session_stream.side_effect = ModelUnavailableError("provider credential detail")
    monkeypatch.setattr(mod, "build_service", lambda: service)

    result = mod._create({"scenario": "build", "app_id": "a1", "goal_text": "Build it"}, _actor())

    assert result == (
        {"code": "model_unavailable", "message": "Builder model is unavailable", "recoverable": True},
        400,
    )


def test_action_always_returns_event_stream_and_resolves_action_id(monkeypatch):
    service = MagicMock()
    service.submit_action_stream.return_value = _frames()
    monkeypatch.setattr(mod, "build_service", lambda: service)
    actor = _actor()

    response = mod._action(
        "s1",
        {
            "action_id": "run_validation",
            "payload": {"scope": "changed"},
            "base_version": 1,
            "base_app_revision": "hash-1",
        },
        actor,
    )

    _assert_event_stream(response)
    called_session_id, called_actor, action = service.submit_action_stream.call_args.args
    assert (called_session_id, called_actor) == ("s1", actor)
    assert action.kind == "run_verify"
    assert action.payload == {"scope": "changed"}
    assert action.base_version == 1
    assert action.base_app_revision == "hash-1"
    service.submit_action.assert_not_called()


@pytest.mark.parametrize(
    "payload",
    [
        None,
        {"payload": {}, "base_version": 1, "base_app_revision": "hash-1"},
        {"action_id": "", "payload": {}, "base_version": 1, "base_app_revision": "hash-1"},
        {"action_id": "run_validation", "payload": None, "base_version": 1, "base_app_revision": "hash-1"},
        {"action_id": "run_validation", "payload": {}, "base_version": True, "base_app_revision": "hash-1"},
        {"action_id": "run_validation", "payload": {}, "base_version": 1},
        {
            "action_id": "run_validation",
            "payload": {},
            "base_version": 1,
            "base_app_revision": "hash-1",
            "response_mode": "streaming",
        },
        {
            "action_id": "run_validation",
            "kind": "run_verify",
            "payload": {},
            "base_version": 1,
            "base_app_revision": "hash-1",
        },
    ],
)
def test_action_rejects_malformed_or_legacy_payload_before_service(monkeypatch, payload):
    service = MagicMock()
    monkeypatch.setattr(mod, "build_service", lambda: service)

    assert mod._action("s1", payload, _actor()) == ({"code": "bad_request"}, 400)
    assert not service.mock_calls


def test_action_maps_pre_stream_conflict(monkeypatch):
    service = MagicMock()
    service.submit_action_stream.side_effect = ConflictError("stale")
    monkeypatch.setattr(mod, "build_service", lambda: service)

    result = mod._action(
        "s1",
        {
            "action_id": "run_verify",
            "payload": {},
            "base_version": 1,
            "base_app_revision": "hash-1",
        },
        _actor(),
    )

    assert result == ({"code": "conflict"}, 409)


def test_message_always_returns_event_stream(monkeypatch):
    service = MagicMock()
    service.submit_message_stream.return_value = _frames()
    monkeypatch.setattr(mod, "build_service", lambda: service)
    actor = _actor()

    response = mod._message(
        "s1",
        {"text": "hi", "base_version": 2, "client_turn_id": "turn-1"},
        actor,
    )

    _assert_event_stream(response)
    service.submit_message_stream.assert_called_once_with("s1", actor, "hi", 2, "turn-1")
    service.submit_message.assert_not_called()


@pytest.mark.parametrize(
    "payload",
    [
        None,
        {"text": "hi", "base_version": 1},
        {"text": " ", "base_version": 1, "client_turn_id": "turn-1"},
        {"text": "hi", "base_version": True, "client_turn_id": "turn-1"},
        {"text": "hi", "base_version": 1, "client_turn_id": " "},
        {
            "text": "hi",
            "base_version": 1,
            "client_turn_id": "turn-1",
            "response_mode": "streaming",
        },
    ],
)
def test_message_rejects_malformed_or_legacy_payload_before_service(monkeypatch, payload):
    service = MagicMock()
    monkeypatch.setattr(mod, "build_service", lambda: service)

    assert mod._message("s1", payload, _actor()) == ({"code": "bad_request"}, 400)
    assert not service.mock_calls


def test_stream_authorizes_then_subscribes_before_reading_state(monkeypatch):
    calls: list[str] = []
    subscription = MagicMock()
    service = MagicMock()

    service.authorize_session.side_effect = lambda *_args: calls.append("authorize")
    service.get_session_view.side_effect = lambda *_args: (calls.append("view"), _session_view())[1]

    def subscribe(_session_id: str):
        calls.append("subscribe")
        return subscription

    stream = MagicMock(return_value=iter(["data: {}\n\n"]))
    monkeypatch.setattr(mod, "build_service", lambda: service)
    monkeypatch.setattr(mod.progress_bus, "subscribe", subscribe)
    monkeypatch.setattr(mod, "stream_advance_frames", stream)

    response = mod._stream("s1", _actor())

    _assert_event_stream(response)
    assert calls == ["authorize", "subscribe", "view"]
    assert stream.call_args.kwargs["expect_advance"] is True
    assert stream.call_args.kwargs["emit_command_started"] is False
    assert stream.call_args.kwargs["emit_command_finished_when_settled"] is True
    assert stream.call_args.kwargs["command_id"] == ""


def test_stream_settled_state_does_not_watch_for_progress(monkeypatch):
    service = MagicMock()
    service.get_session_view.return_value = _session_view(run_status=RunStatus.COMPLETE)
    subscription = MagicMock()
    stream = MagicMock(return_value=iter(["data: {}\n\n"]))
    monkeypatch.setattr(mod, "build_service", lambda: service)
    monkeypatch.setattr(mod.progress_bus, "subscribe", lambda _session_id: subscription)
    monkeypatch.setattr(mod, "stream_advance_frames", stream)

    response = mod._stream("s1", _actor())

    _assert_event_stream(response)
    assert stream.call_args.kwargs["expect_advance"] is False
    assert stream.call_args.kwargs["emit_command_started"] is False
    assert stream.call_args.kwargs["emit_command_finished_when_settled"] is True


def test_stream_closes_subscription_when_state_is_unavailable(monkeypatch):
    subscription = MagicMock()
    service = MagicMock()
    service.get_session_view.side_effect = NotFoundError("missing")
    monkeypatch.setattr(mod.progress_bus, "subscribe", lambda _session_id: subscription)
    monkeypatch.setattr(mod, "build_service", lambda: service)

    result = mod._stream("s1", _actor())

    assert result == ({"code": "not_found"}, 404)
    subscription.close.assert_called_once_with()


def test_stream_authorizes_before_opening_subscription(monkeypatch):
    service = MagicMock()
    service.authorize_session.side_effect = NotFoundError("missing")
    subscribe = MagicMock()
    monkeypatch.setattr(mod.progress_bus, "subscribe", subscribe)
    monkeypatch.setattr(mod, "build_service", lambda: service)

    assert mod._stream("s1", _actor()) == ({"code": "not_found"}, 404)
    subscribe.assert_not_called()


def test_stream_response_returns_event_stream_on_success():
    response = _assert_event_stream(mod._stream_response(_frames))
    assert b'"event": "command_started"' in response.get_data()


def test_stream_response_maps_known_error_to_http_tuple():
    def make_generator():
        raise ConflictError("stale")

    assert mod._stream_response(make_generator) == ({"code": "conflict"}, 409)


def test_stream_response_reraises_unmapped_exception():
    def make_generator():
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError):
        mod._stream_response(make_generator)


def test_dify_builder_required_blocks_when_feature_disabled(monkeypatch):
    wrapped = mod.dify_builder_required(lambda *_args, **_kwargs: ({"ok": True}, 200))
    features = MagicMock(dify_builder_enabled=False)
    monkeypatch.setattr(mod.FeatureService, "get_features", lambda _tenant_id: features)

    assert wrapped(object(), "t") == ({"code": "feature_unavailable"}, 403)


def test_dify_builder_required_passes_through_when_enabled(monkeypatch):
    def view(_self, current_tenant_id, *_args, **_kwargs):
        return {"current_tenant_id": current_tenant_id}, 200

    features = MagicMock(dify_builder_enabled=True)
    monkeypatch.setattr(mod.FeatureService, "get_features", lambda _tenant_id: features)

    assert mod.dify_builder_required(view)(object(), "t") == ({"current_tenant_id": "t"}, 200)


def test_decorator_stack_injects_positionally_in_method_order(monkeypatch):
    account = _account()
    monkeypatch.setattr(wraps_mod, "current_account_with_tenant", lambda: (account, "ten-9"))
    monkeypatch.setattr(
        mod.FeatureService,
        "get_features",
        lambda _tenant_id: MagicMock(dify_builder_enabled=True),
    )
    captured = {}

    def view(self, current_tenant_id, current_user, **kwargs):
        captured.update(self=self, tenant=current_tenant_id, user=current_user, kwargs=kwargs)
        return {"ok": True}, 200

    composed = wraps_mod.with_current_user(wraps_mod.with_current_tenant_id(mod.dify_builder_required(view)))
    sentinel = object()

    assert composed(sentinel, session_id="s1") == ({"ok": True}, 200)
    assert captured == {"self": sentinel, "tenant": "ten-9", "user": account, "kwargs": {"session_id": "s1"}}


def test_decorator_stack_gate_blocks_when_feature_off(monkeypatch):
    monkeypatch.setattr(wraps_mod, "current_account_with_tenant", lambda: (_account(), "ten-9"))
    monkeypatch.setattr(
        mod.FeatureService,
        "get_features",
        lambda _tenant_id: MagicMock(dify_builder_enabled=False),
    )

    def view(*_args, **_kwargs):
        raise AssertionError("view must not run when the feature is off")

    composed = wraps_mod.with_current_user(wraps_mod.with_current_tenant_id(mod.dify_builder_required(view)))
    assert composed(object(), session_id="s1") == ({"code": "feature_unavailable"}, 403)


@pytest.mark.parametrize(
    "method",
    [
        mod.DifyBuilderSessionsApi.post,
        mod.DifyBuilderSessionApi.get,
        mod.DifyBuilderConversationApi.get,
        mod.DifyBuilderSessionStreamApi.get,
        mod.DifyBuilderActionsApi.post,
        mod.DifyBuilderMessagesApi.post,
        mod.DifyBuilderRealCallConsentsApi.post,
        mod.DifyBuilderRealCallConsentApi.get,
        mod.DifyBuilderRealCallConsentConfirmApi.post,
        mod.DifyBuilderRealCallConsentExecuteApi.post,
    ],
)
def test_session_routes_require_legacy_edit_permission(method):
    gate = unwrap(method, stop=lambda wrapper: "edit_permission_required" in wrapper.__code__.co_qualname)
    assert "edit_permission_required" in gate.__code__.co_qualname


def test_create_build_defaults_to_not_renaming_the_app(monkeypatch):
    service = MagicMock()
    service.create_build_session_stream.return_value = _frames()
    monkeypatch.setattr(mod, "build_service", lambda: service)

    mod._create({"scenario": "build", "app_id": "a1", "goal_text": "Build it"}, _actor())

    assert service.create_build_session_stream.call_args.kwargs["derive_app_name"] is False


def test_create_build_forwards_the_rename_opt_in(monkeypatch):
    service = MagicMock()
    service.create_build_session_stream.return_value = _frames()
    monkeypatch.setattr(mod, "build_service", lambda: service)

    mod._create(
        {"scenario": "build", "app_id": "a1", "goal_text": "Build it", "derive_app_name": True},
        _actor(),
    )

    assert service.create_build_session_stream.call_args.kwargs["derive_app_name"] is True


def test_action_resolves_confirm_through_the_option_the_client_chose(monkeypatch):
    service = MagicMock()
    service.submit_action_stream.return_value = _frames()
    monkeypatch.setattr(mod, "build_service", lambda: service)

    response = mod._action(
        "s1",
        {
            "action_id": "confirm",
            "payload": {"option_id": "run_validation", "free_text": ""},
            "base_version": 1,
            "base_app_revision": "hash-1",
        },
        _actor(),
    )

    _assert_event_stream(response)

    action = service.submit_action_stream.call_args.args[2]
    assert action.kind == "run_verify"
    # The chosen option and any free text travel on to the handler untouched.
    assert action.payload == {"option_id": "run_validation", "free_text": ""}


def test_action_still_accepts_a_client_posting_the_bare_action_id(monkeypatch):
    service = MagicMock()
    service.submit_action_stream.return_value = _frames()
    monkeypatch.setattr(mod, "build_service", lambda: service)

    mod._action(
        "s1",
        {"action_id": "run_validation", "payload": {}, "base_version": 1, "base_app_revision": "hash-1"},
        _actor(),
    )

    assert service.submit_action_stream.call_args.args[2].kind == "run_verify"


@pytest.mark.parametrize(
    "evidence", [None, {}, {"null": None, "false": False, "zero": 0, "empty": "", "list": [], "map": {}}]
)
def test_conversation_result_preserves_terminal_evidence_through_derived_json(monkeypatch, evidence):
    service = MagicMock()
    service.get_conversation_page.return_value = ConversationPage(
        data=[
            ConversationItem(
                seq=0,
                kind="test_result",
                at_version=1,
                payload={
                    "status": "succeeded",
                    "outcome": "execution_succeeded_needs_review",
                    "terminal_outputs": evidence,
                    "executed_node_ids": ["end-1"],
                    "review_note": "Review outputs",
                },
            )
        ],
        has_more=False,
        first_seq=0,
        last_seq=0,
    )
    monkeypatch.setattr(mod, "build_service", lambda: service)
    payload = json.loads(json.dumps(mod._conversation("s1", {}, _actor())))["data"][0]["payload"]
    assert payload["terminal_outputs"] == evidence
    if evidence:
        assert payload["terminal_outputs"]["false"] is False
        assert type(payload["terminal_outputs"]["zero"]) is int
    assert payload["executed_node_ids"] == ["end-1"]
    assert payload["outcome"] == "execution_succeeded_needs_review"
    assert payload["review_note"] == "Review outputs"


def test_conversation_historical_result_keeps_missing_evidence_unavailable(monkeypatch):
    service = MagicMock()
    service.get_conversation_page.return_value = ConversationPage(
        data=[ConversationItem(seq=0, kind="test_result", at_version=1, payload={"status": "succeeded"})],
        has_more=False,
        first_seq=0,
        last_seq=0,
    )
    monkeypatch.setattr(mod, "build_service", lambda: service)
    payload = mod._conversation("s1", {}, _actor())["data"][0]["payload"]
    assert payload["terminal_outputs"] is None
    assert payload["outcome"] is None


def test_conversation_schema_derives_optional_nullable_terminal_evidence():
    from controllers.console.dify_builder_fields import DifyBuilderConversationPageResponse

    schema = DifyBuilderConversationPageResponse.model_json_schema(mode="serialization")
    card = schema["$defs"]["TestResultCard"]
    assert "terminal_outputs" not in card["required"]
    assert card["properties"]["terminal_outputs"]["anyOf"] == [
        {"additionalProperties": True, "type": "object"},
        {"type": "null"},
    ]
    assert card["properties"]["executed_node_ids"]["items"] == {"type": "string"}
    assert card["properties"]["outcome"]["anyOf"][0]["enum"] == [
        "execution_succeeded_needs_review",
        "required_output_unresolved",
        "execution_failed",
        "execution_unknown",
    ]


# -- explicit native Tool consent routes --------------------------------------

_SESSION_ID = "0192a4b0-0000-7000-8000-000000000001"
_CONSENT_ID = "0192a4b0-0000-7000-8000-000000000002"
_TEST_INPUT_ID = "0192a4b0-0000-7000-8000-000000000003"
_CREDENTIAL_ID = "0192a4b0-0000-7000-8000-000000000004"
_COMMAND_ID = "0192a4b0-0000-7000-8000-000000000005"
_REQUEST_ID = "0192a4b0-0000-7000-8000-000000000006"
_SCOPE = "a" * 64
_REVISION = "b" * 64
_ACTOR = Actor(account_id="acc-1", tenant_id="ten-1")
# Names of internal binding/revision/secret material that must never become public.
_INTERNAL_FIELDS = frozenset(
    {
        "binding",
        "revision",
        "oauth_client_revision",
        "initial_credential_revision",
        "derived_credential_revision",
        "credential_revision",
        "encrypted_credentials",
        "ciphertext",
        "access_token",
        "refresh_token",
        "provider_error",
        "context",
        "context_digest",
        "guard",
        "authority",
        "installed",
        "checksum",
        "schema_digest",
        "prepare_key",
        "confirm_key",
        "execute_key",
    }
)

_PREPARE_BODY: dict[str, object] = {
    "node_id": "tool-1",
    "test_input_id": _TEST_INPUT_ID,
    "credential_id": _CREDENTIAL_ID,
    "at_version": 3,
    "base_app_revision": _REVISION,
    "idempotency_key": "prepare-1",
}
_CONFIRM_BODY: dict[str, object] = {
    "decision": "confirm",
    "scope_digest": _SCOPE,
    "at_version": 3,
    "idempotency_key": "confirm-1",
}
_EXECUTE_BODY: dict[str, object] = {"scope_digest": _SCOPE, "at_version": 3, "idempotency_key": "execute-1"}


def _receipt(**overrides: object) -> ConsentReceipt:
    disclosure: dict[str, object] = {
        "action": "get_message",
        "credential_id": _CREDENTIAL_ID,
        "credential_alias": "Ops mailbox",
        "credential_type": "oauth2",
        "identity_basis": "workspace_credential",
        "remote_account_status": "unknown",
        "message_id": "msg-1",
        "request_method": "GET",
        "request_url": gmail_message_url("msg-1"),
        "response_format": "full",
        "include_body": True,
        "include_attachments": False,
        "oauth_refresh": "if_needed",
        "oauth_refresh_method": "POST",
        "oauth_refresh_url": "https://oauth2.googleapis.com/token",
        "native_attempt_limit": 1,
        "refresh_limit": 1,
        "automatic_replay": False,
        "quota_usage": "possible",
        "monetary_estimate": "unknown",
        "output_retention": "native_run_retention",
        "data_description": "gmail_message_headers_snippet_and_selected_body_or_attachment_metadata",
        "expires_at": datetime(2026, 10, 11, 12, 10, tzinfo=UTC),
        "prior_uncertain_consent_id": None,
    }
    base: dict[str, object] = {
        "consent_id": _CONSENT_ID,
        "scope_digest": _SCOPE,
        "state": "prepared",
        "at_version": 3,
        "disclosure": disclosure,
        "command_id": None,
        "execution_request_id": None,
        "native_run_id": None,
        "native_node_execution_id": None,
        "reason_code": None,
        "refresh_claimed": False,
        "business_claimed": False,
        "can_retry": False,
    }
    return ConsentReceipt.model_validate(base | overrides)


def _claimed_receipt() -> ConsentReceipt:
    return _receipt(
        state="claimed",
        command_id=_COMMAND_ID,
        execution_request_id=_REQUEST_ID,
        native_run_id="run-1",
        native_node_execution_id="node-execution-1",
        refresh_claimed=True,
        business_claimed=True,
        can_retry=False,
    )


def _reserved_receipt() -> ConsentReceipt:
    return _receipt(state="confirmed", command_id=_COMMAND_ID, execution_request_id=_REQUEST_ID)


def _no_dispatch() -> DifyBuilderService:
    raise AssertionError("prepare/confirm/status must not build the dispatch owner")


def _no_consent_factory() -> BuilderRealCallConsentService:
    raise AssertionError("execute must go through the DifyBuilderService confirmed coordinator")


def _consent_service(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    consent = MagicMock(spec=BuilderRealCallConsentService)
    monkeypatch.setattr(mod, "build_real_call_consent_service", lambda: consent)
    monkeypatch.setattr(mod, "build_service", _no_dispatch)
    return consent


def _decorator_chain(method: Callable[..., object]) -> list[str]:
    """Owner of each wrapper from the outermost decorator inward."""
    names: list[str] = []

    def record(wrapper: object) -> bool:
        names.append(cast(FunctionType, wrapper).__code__.co_qualname.split(".")[0])
        return False

    unwrap(method, stop=record)
    return names


class _ApiDoc(TypedDict, total=False):
    expect: list[SchemaModel]
    params: dict[str, object]
    responses: dict[str, tuple[str, SchemaModel, dict[str, object]]]


def _apidoc(method: Callable[..., object]) -> _ApiDoc:
    return cast(_ApiDoc, vars(method)["__apidoc__"])


def test_execute_cannot_change_parameters_or_forge_credentials() -> None:
    body = {"scope_digest": "a" * 64, "at_version": 1, "idempotency_key": "execute-1"}
    for injected in ({"parameters": {"message_id": "other"}}, {"credential_id": "other"}, {"at_version": True}):
        with pytest.raises(ValidationError):
            DifyBuilderExecuteRealCallPayload.model_validate(body | injected)


@pytest.mark.parametrize(
    "injected",
    [
        {"inputs": {"message_id": "other"}},
        {"graph": {"nodes": []}},
        {"context": {"mode": "confirmed_tool"}},
        {"execution_context": {}},
        {"guard": {}},
        {"binding": {}},
        {"authority": "confirmed"},
        {"command_id": _COMMAND_ID},
        {"at_version": 0},
        {"at_version": "1"},
        {"at_version": 1.0},
        {"at_version": None},
        {"scope_digest": "A" * 64},
        {"scope_digest": "a" * 63},
        {"scope_digest": "a" * 64 + "\n"},
        {"scope_digest": "g" * 64},
        {"idempotency_key": ""},
        {"idempotency_key": "k" * 129},
        {"idempotency_key": 7},
    ],
)
def test_execute_payload_rejects_authority_and_unbounded_fields(injected: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        DifyBuilderExecuteRealCallPayload.model_validate(_EXECUTE_BODY | injected)


def test_execute_payload_accepts_only_declared_fields() -> None:
    payload = DifyBuilderExecuteRealCallPayload.model_validate(_EXECUTE_BODY | {"idempotency_key": "k" * 128})

    assert payload.model_dump() == {"scope_digest": _SCOPE, "at_version": 3, "idempotency_key": "k" * 128}
    assert set(DifyBuilderExecuteRealCallPayload.model_fields) == {"scope_digest", "at_version", "idempotency_key"}


@pytest.mark.parametrize(
    "injected",
    [
        {"parameters": {"message_id": "other"}},
        {"credential": {"id": _CREDENTIAL_ID}},
        {"inputs": {}},
        {"binding": {}},
        {"node_id": ""},
        {"node_id": "n" * 129},
        {"test_input_id": ""},
        {"credential_id": "c" * 129},
        {"credential_id": 4},
        {"base_app_revision": ""},
        {"base_app_revision": "r" * 129},
        {"at_version": True},
        {"at_version": 0},
        {"at_version": "3"},
        {"idempotency_key": ""},
        {"idempotency_key": "k" * 129},
    ],
)
def test_prepare_payload_is_strict_and_bounded(injected: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        DifyBuilderPrepareRealCallPayload.model_validate(_PREPARE_BODY | injected)


@pytest.mark.parametrize("missing", sorted(_PREPARE_BODY))
def test_prepare_payload_requires_every_declared_field(missing: str) -> None:
    body = {key: value for key, value in _PREPARE_BODY.items() if key != missing}
    with pytest.raises(ValidationError):
        DifyBuilderPrepareRealCallPayload.model_validate(body)


@pytest.mark.parametrize("decision", ["confirm", "decline"])
def test_confirm_payload_accepts_both_decisions(decision: str) -> None:
    payload = DifyBuilderConfirmRealCallPayload.model_validate(_CONFIRM_BODY | {"decision": decision})
    assert payload.decision == decision


@pytest.mark.parametrize(
    "injected",
    [
        {"decision": "approve"},
        {"decision": "CONFIRM"},
        {"decision": None},
        {"scope_digest": "z" * 64},
        {"at_version": False},
        {"at_version": -1},
        {"idempotency_key": ""},
        {"credential_id": _CREDENTIAL_ID},
        {"parameters": {}},
    ],
)
def test_confirm_payload_is_strict(injected: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        DifyBuilderConfirmRealCallPayload.model_validate(_CONFIRM_BODY | injected)


def test_prepare_route_passes_trusted_actor_and_returns_created_receipt(monkeypatch: pytest.MonkeyPatch) -> None:
    consent = _consent_service(monkeypatch)
    consent.prepare.return_value = _receipt()

    body, status = mod._prepare_real_call(_SESSION_ID, dict(_PREPARE_BODY), _ACTOR)

    assert status == 201
    assert body["result"] == "receipt"
    assert body["state"] == "prepared"
    assert body["scope_digest"] == _SCOPE
    assert body["disclosure"]["identity_basis"] == "workspace_credential"
    assert body["disclosure"]["remote_account_status"] == "unknown"
    # Prepare only freezes metadata: the single consent call, nothing runtime/dispatch.
    assert consent.mock_calls == [
        call.prepare(
            actor=_ACTOR,
            session_id=_SESSION_ID,
            node_id="tool-1",
            test_input_id=_TEST_INPUT_ID,
            credential_id=_CREDENTIAL_ID,
            at_version=3,
            base_app_revision=_REVISION,
            idempotency_key="prepare-1",
        )
    ]


@pytest.mark.parametrize(
    "route",
    [
        lambda body: mod._prepare_real_call(_SESSION_ID, body, _ACTOR),
        lambda body: mod._confirm_real_call(_SESSION_ID, _CONSENT_ID, body, _ACTOR),
        lambda body: mod._execute_real_call(_SESSION_ID, _CONSENT_ID, body, _ACTOR),
    ],
)
@pytest.mark.parametrize("body", [{}, [], "text", {"at_version": True}])
def test_consent_routes_reject_invalid_bodies_before_any_service(
    monkeypatch: pytest.MonkeyPatch, route: Callable[[object], object], body: object
) -> None:
    consent = _consent_service(monkeypatch)

    assert route(body) == ({"code": "bad_request"}, 400)
    assert not consent.mock_calls


@pytest.mark.parametrize(
    ("reason", "status", "expected"),
    [
        ("needs_setup", 409, {"result": "refusal", "code": "needs_setup", "reason_code": "needs_setup"}),
        (
            "credential_required",
            409,
            {"result": "refusal", "code": "needs_setup", "reason_code": "credential_required"},
        ),
        (
            "credential_reference_unavailable",
            409,
            {"result": "refusal", "code": "needs_permission", "reason_code": "credential_reference_unavailable"},
        ),
        (
            "unsupported_action",
            409,
            {"result": "refusal", "code": "unsupported_action", "reason_code": "unsupported_action"},
        ),
        (
            "unsupported_session_state",
            409,
            {"result": "refusal", "code": "unsupported_action", "reason_code": "unsupported_session_state"},
        ),
        (
            "installed_tool_unavailable",
            409,
            {"result": "refusal", "code": "unavailable_metadata", "reason_code": "installed_tool_unavailable"},
        ),
        (
            "stale_session_version",
            409,
            {"result": "refusal", "code": "conflict", "reason_code": "stale_session_version"},
        ),
        ("stale_app_revision", 409, {"result": "refusal", "code": "conflict", "reason_code": "stale_app_revision"}),
        (
            "idempotency_conflict",
            409,
            {"result": "refusal", "code": "conflict", "reason_code": "idempotency_conflict"},
        ),
        (
            "execution_permission_denied",
            403,
            {"result": "refusal", "code": "needs_permission", "reason_code": "execution_permission_denied"},
        ),
        ("execution_owner_mismatch", 404, {"code": "not_found"}),
        ("consent_not_found", 404, {"code": "not_found"}),
        ("invalid_version", 400, {"code": "bad_request"}),
        # Corrupt records and unlisted internal reasons collapse into one fixed public answer.
        (
            "consent_record_invalid",
            409,
            {"result": "refusal", "code": "unavailable_metadata", "reason_code": "real_call_unavailable"},
        ),
        (
            "an_unlisted_internal_reason",
            409,
            {"result": "refusal", "code": "unavailable_metadata", "reason_code": "real_call_unavailable"},
        ),
    ],
)
def test_prepare_maps_domain_refusals_to_fixed_public_codes(
    monkeypatch: pytest.MonkeyPatch, reason: str, status: int, expected: dict[str, str]
) -> None:
    consent = _consent_service(monkeypatch)
    consent.prepare.side_effect = BuilderExecutionPolicyError(reason)

    result = mod._prepare_real_call(_SESSION_ID, dict(_PREPARE_BODY), _ACTOR)

    assert result == (expected, status)
    # Each body conforms to the model documented for its status.
    if status == 403:
        DifyBuilderRealCallForbiddenResponse.model_validate(expected)
    elif "result" in expected:
        assert DifyBuilderRealCallRefusalResponse.model_validate(expected).reason_code == expected["reason_code"]


def test_refusal_never_echoes_exception_text(monkeypatch: pytest.MonkeyPatch) -> None:
    consent = _consent_service(monkeypatch)
    leaked = "provider said token=ya29.secret for alice@example.com"
    consent.prepare.side_effect = BuilderExecutionPolicyError(leaked)

    result = mod._prepare_real_call(_SESSION_ID, dict(_PREPARE_BODY), _ACTOR)

    assert "secret" not in json.dumps(result)
    assert "alice" not in json.dumps(result)
    assert result == (
        {"result": "refusal", "code": "unavailable_metadata", "reason_code": "real_call_unavailable"},
        409,
    )


def test_unexpected_consent_failure_is_not_serialized(monkeypatch: pytest.MonkeyPatch) -> None:
    consent = _consent_service(monkeypatch)
    consent.get.side_effect = RuntimeError("ciphertext=abc")

    with pytest.raises(RuntimeError):
        mod._get_real_call(_SESSION_ID, _CONSENT_ID, _ACTOR)


def test_every_mapped_refusal_reason_is_a_declared_public_reason() -> None:
    declared = set(get_args(DifyBuilderRealCallRefusalReason))
    assert set(wiring.REAL_CALL_REFUSAL_REASONS) == declared
    assert "real_call_unavailable" in declared
    assert "session_busy" in declared
    # The permission reason is only ever a 403 and has its own narrowed leaf.
    assert "execution_permission_denied" not in declared


@pytest.mark.parametrize("decision", ["confirm", "decline"])
def test_confirm_route_records_decision_without_dispatch(monkeypatch: pytest.MonkeyPatch, decision: str) -> None:
    consent = _consent_service(monkeypatch)
    state = "confirmed" if decision == "confirm" else "declined"
    consent.confirm.return_value = _receipt(state=state, can_retry=decision == "decline")

    body, status = mod._confirm_real_call(_SESSION_ID, _CONSENT_ID, _CONFIRM_BODY | {"decision": decision}, _ACTOR)

    assert status == 200
    assert body["state"] == state
    # A decision (including decline) never reaches the dispatch owner or enqueues.
    assert consent.mock_calls == [
        call.confirm(
            actor=_ACTOR,
            session_id=_SESSION_ID,
            consent_id=_CONSENT_ID,
            decision=decision,
            scope_digest=_SCOPE,
            at_version=3,
            idempotency_key="confirm-1",
        )
    ]


def test_confirm_replay_returns_the_saved_decision_receipt(monkeypatch: pytest.MonkeyPatch) -> None:
    consent = _consent_service(monkeypatch)
    saved = _receipt(state="confirmed")
    # The owner answers an identical replay from the saved decision even after later advancement.
    consent.confirm.side_effect = [saved, saved]

    first = mod._confirm_real_call(_SESSION_ID, _CONSENT_ID, dict(_CONFIRM_BODY), _ACTOR)
    replay = mod._confirm_real_call(_SESSION_ID, _CONSENT_ID, dict(_CONFIRM_BODY), _ACTOR)

    assert first == replay
    assert first[1] == 200


@pytest.mark.parametrize(
    "reason",
    [
        "consent_scope_mismatch",
        "stale_consent_version",
        "idempotency_conflict",
        "consent_decision_conflict",
        "consent_not_prepared",
        "consent_scope_changed",
        "consent_invalidated",
        "consent_expired",
    ],
)
def test_confirm_scope_version_and_body_conflicts_are_409(monkeypatch: pytest.MonkeyPatch, reason: str) -> None:
    consent = _consent_service(monkeypatch)
    consent.confirm.side_effect = BuilderExecutionPolicyError(reason)

    assert mod._confirm_real_call(_SESSION_ID, _CONSENT_ID, dict(_CONFIRM_BODY), _ACTOR) == (
        {"result": "refusal", "code": "conflict", "reason_code": reason},
        409,
    )


def test_cross_owner_consent_is_indistinguishable_from_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    consent = _consent_service(monkeypatch)
    consent.confirm.side_effect = BuilderExecutionPolicyError("consent_not_found")
    consent.get.side_effect = BuilderExecutionPolicyError("consent_not_found")

    assert mod._confirm_real_call(_SESSION_ID, _CONSENT_ID, dict(_CONFIRM_BODY), _ACTOR) == (
        {"code": "not_found"},
        404,
    )
    assert mod._get_real_call(_SESSION_ID, _CONSENT_ID, _ACTOR) == ({"code": "not_found"}, 404)


def test_status_route_returns_current_receipt_without_execution(monkeypatch: pytest.MonkeyPatch) -> None:
    consent = _consent_service(monkeypatch)
    consent.get.return_value = _claimed_receipt()

    body, status = mod._get_real_call(_SESSION_ID, _CONSENT_ID, _ACTOR)

    assert status == 200
    assert body["state"] == "claimed"
    assert body["can_retry"] is False
    assert consent.mock_calls == [call.get(actor=_ACTOR, session_id=_SESSION_ID, consent_id=_CONSENT_ID)]


def test_execute_route_uses_only_the_confirmed_dispatch_coordinator(monkeypatch: pytest.MonkeyPatch) -> None:
    service = MagicMock(spec=DifyBuilderService)
    service.execute_confirmed_tool.return_value = _reserved_receipt()
    monkeypatch.setattr(mod, "build_service", lambda: service)
    monkeypatch.setattr(mod, "build_real_call_consent_service", _no_consent_factory)

    body, status = mod._execute_real_call(_SESSION_ID, _CONSENT_ID, dict(_EXECUTE_BODY), _ACTOR)

    assert status == 202
    assert body["command_id"] == _COMMAND_ID
    assert body["can_retry"] is False
    assert service.mock_calls == [
        call.execute_confirmed_tool(
            _SESSION_ID,
            _ACTOR,
            consent_id=_CONSENT_ID,
            scope_digest=_SCOPE,
            at_version=3,
            idempotency_key="execute-1",
        )
    ]


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (BusyError("session busy"), ({"result": "refusal", "code": "conflict", "reason_code": "session_busy"}, 409)),
        (
            ConflictError("stale"),
            ({"result": "refusal", "code": "conflict", "reason_code": "session_conflict"}, 409),
        ),
        (NotFoundError("session not found"), ({"code": "not_found"}, 404)),
        (
            Forbidden(),
            ({"result": "refusal", "code": "needs_permission", "reason_code": "execution_permission_denied"}, 403),
        ),
        (
            BuilderExecutionPolicyError("consent_not_confirmed"),
            ({"result": "refusal", "code": "conflict", "reason_code": "consent_not_confirmed"}, 409),
        ),
    ],
)
def test_execute_route_maps_coordinator_failures(
    monkeypatch: pytest.MonkeyPatch, error: Exception, expected: tuple[dict[str, str], int]
) -> None:
    service = MagicMock(spec=DifyBuilderService)
    service.execute_confirmed_tool.side_effect = error
    monkeypatch.setattr(mod, "build_service", lambda: service)

    assert mod._execute_real_call(_SESSION_ID, _CONSENT_ID, dict(_EXECUTE_BODY), _ACTOR) == expected


class _HeldLease:
    """Per-session advance lease: the first acquire wins until its own token is released."""

    def __init__(self) -> None:
        self.tokens: dict[str, str] = {}
        self.acquired = 0
        self.released: list[str] = []

    def acquire(self, session_id: str) -> str | None:
        if session_id in self.tokens:
            return None
        self.acquired += 1
        self.tokens[session_id] = f"token-{self.acquired}"
        return self.tokens[session_id]

    def release(self, session_id: str, token: str) -> None:
        self.released.append(token)
        if self.tokens.get(session_id) == token:
            del self.tokens[session_id]

    def exists(self, session_id: str) -> bool:
        return session_id in self.tokens


def _coordinator(
    monkeypatch: pytest.MonkeyPatch, *, owner_account_id: str = "acc-1"
) -> tuple[MagicMock, _HeldLease, list[tuple[str, Action, Actor, str]], list[str]]:
    """Wire the real DifyBuilderService confirmed coordinator behind the execute route."""
    repo = MagicMock(spec=Repository)
    repo.get_session.return_value = (
        DomainSession(
            id=_SESSION_ID,
            app_id="app-1",
            tenant_id="ten-1",
            owner_account_id=owner_account_id,
            entry_mode=EntryMode.BUILD,
            current_state=PcState.BUILD_REVIEW,
            version=3,
        ),
        DifyBuilderContext(),
    )
    consent = MagicMock(spec=BuilderRealCallConsentService)
    lease = _HeldLease()
    enqueued: list[tuple[str, Action, Actor, str]] = []
    authorized: list[str] = []

    def enqueue(session_id: str, action: Action, actor: Actor, token: str) -> None:
        enqueued.append((session_id, action, actor, token))

    def authorize(actor: Actor, app_id: str, access: object) -> None:
        authorized.append(f"{actor.account_id}:{app_id}:{access}")

    service = DifyBuilderService(
        cast(Repository, repo),
        lease,
        enqueue,
        authorize_app_fn=authorize,
        real_call_consent=cast(BuilderRealCallConsentService, consent),
    )
    monkeypatch.setattr(mod, "build_service", lambda: service)
    monkeypatch.setattr(mod, "build_real_call_consent_service", _no_consent_factory)
    return consent, lease, enqueued, authorized


def test_matching_execute_replay_returns_current_receipt_without_extra_enqueue(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    consent, lease, enqueued, authorized = _coordinator(monkeypatch)
    consent.reserve_execution.return_value = (_reserved_receipt(), True)
    consent.replay_execution.return_value = _claimed_receipt()

    first_body, first_status = mod._execute_real_call(_SESSION_ID, _CONSENT_ID, dict(_EXECUTE_BODY), _ACTOR)
    replay_body, replay_status = mod._execute_real_call(_SESSION_ID, _CONSENT_ID, dict(_EXECUTE_BODY), _ACTOR)

    assert (first_status, replay_status) == (202, 202)
    # Stable identities; the replay reports the CURRENT receipt of the same command.
    assert (replay_body["consent_id"], replay_body["command_id"]) == (_CONSENT_ID, _COMMAND_ID)
    assert first_body["command_id"] == replay_body["command_id"]
    assert replay_body["state"] == "claimed"
    assert replay_body["can_retry"] is False
    # Exactly one reservation and one enqueue of the already reserved command, on the winning token.
    consent.reserve_execution.assert_called_once()
    assert len(enqueued) == 1
    session_id, action, actor, token = enqueued[0]
    assert (session_id, actor, token) == (_SESSION_ID, _ACTOR, "token-1")
    assert action.kind == CONFIRMED_TOOL_ACTION
    assert action.command_id == _COMMAND_ID
    assert action.payload == {"consent_id": _CONSENT_ID}
    # The held lease answered the duplicate from the replay with the same body; nothing released.
    consent.replay_execution.assert_called_once_with(
        actor=_ACTOR,
        session_id=_SESSION_ID,
        consent_id=_CONSENT_ID,
        scope_digest=_SCOPE,
        at_version=3,
        idempotency_key="execute-1",
    )
    assert lease.acquired == 1
    assert lease.released == []
    assert authorized == ["acc-1:app-1:test_and_run", "acc-1:app-1:test_and_run"]


def test_held_lease_without_saved_execute_is_busy(monkeypatch: pytest.MonkeyPatch) -> None:
    consent, lease, enqueued, _authorized = _coordinator(monkeypatch)
    lease.tokens[_SESSION_ID] = "other-command"
    consent.replay_execution.return_value = None

    assert mod._execute_real_call(_SESSION_ID, _CONSENT_ID, dict(_EXECUTE_BODY), _ACTOR) == (
        {"result": "refusal", "code": "conflict", "reason_code": "session_busy"},
        409,
    )
    consent.reserve_execution.assert_not_called()
    assert enqueued == []


def test_execute_refusal_releases_only_its_own_lease_and_never_enqueues(monkeypatch: pytest.MonkeyPatch) -> None:
    consent, lease, enqueued, _authorized = _coordinator(monkeypatch)
    consent.reserve_execution.side_effect = BuilderExecutionPolicyError("consent_scope_mismatch")

    assert mod._execute_real_call(_SESSION_ID, _CONSENT_ID, dict(_EXECUTE_BODY), _ACTOR) == (
        {"result": "refusal", "code": "conflict", "reason_code": "consent_scope_mismatch"},
        409,
    )
    assert lease.released == ["token-1"]
    assert enqueued == []


def test_execute_on_another_owners_session_is_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    consent, lease, enqueued, authorized = _coordinator(monkeypatch, owner_account_id="someone-else")

    assert mod._execute_real_call(_SESSION_ID, _CONSENT_ID, dict(_EXECUTE_BODY), _ACTOR) == (
        {"code": "not_found"},
        404,
    )
    assert not consent.mock_calls
    assert (lease.acquired, enqueued, authorized) == (0, [], [])


def test_public_receipt_omits_internal_fields_and_disables_retry_after_claim() -> None:
    receipt = _claimed_receipt().model_dump()
    # Even if a caller hands over a richer internal object, only declared public fields serialize.
    internal = receipt | dict.fromkeys(_INTERNAL_FIELDS, "leak")
    internal["disclosure"] = receipt["disclosure"] | {"revision": "leak", "oauth_client_revision": "leak"}

    body = mod.dump_response(DifyBuilderRealCallConsentResponse, internal)

    assert body["can_retry"] is False
    assert body["refresh_claimed"] is True
    assert body["business_claimed"] is True
    assert not _INTERNAL_FIELDS & set(body)
    assert not _INTERNAL_FIELDS & set(body["disclosure"])
    assert "leak" not in json.dumps(body)
    assert set(body) == {"result", *ConsentReceipt.model_fields}
    assert body["disclosure"]["expires_at"] == "2026-10-11T12:10:00Z"


def _schema_property_names(schema: object) -> set[str]:
    names: set[str] = set()
    if isinstance(schema, dict):
        properties = schema.get("properties")
        if isinstance(properties, dict):
            names.update(properties)
        for value in schema.values():
            names |= _schema_property_names(value)
    elif isinstance(schema, list):
        for value in schema:
            names |= _schema_property_names(value)
    return names


def test_consent_response_schema_is_public_with_bounded_unknown_and_conditional_refresh() -> None:
    schema = DifyBuilderRealCallConsentResponse.model_json_schema(mode="serialization")
    properties = schema["properties"]
    disclosure = schema["$defs"]["DifyBuilderRealCallDisclosureResponse"]["properties"]

    assert not _INTERNAL_FIELDS & _schema_property_names(schema)
    assert "result" in schema["required"]
    assert properties["result"]["const"] == "receipt"
    assert "unknown" in properties["state"]["enum"]
    state_text = properties["state"]["description"]
    assert "unknown" in state_text
    assert "never replayed automatically" in state_text
    assert "one native attempt and at most one token refresh" in state_text
    assert "new human-approved consent" in state_text
    assert "reserved or claimed" in properties["can_retry"]["description"]
    assert "only if the stored access token must be refreshed" in disclosure["oauth_refresh"]["description"]
    assert disclosure["oauth_refresh_url"]["const"] == "https://oauth2.googleapis.com/token"
    assert disclosure["identity_basis"]["const"] == "workspace_credential"
    assert disclosure["remote_account_status"]["const"] == "unknown"
    assert disclosure["automatic_replay"]["const"] is False


def test_receipt_and_refusal_round_trip_through_the_result_discriminator() -> None:
    adapter: TypeAdapter[DifyBuilderRealCallConsentResponse | DifyBuilderRealCallRefusalResponse] = TypeAdapter(
        Annotated[
            DifyBuilderRealCallConsentResponse | DifyBuilderRealCallRefusalResponse,
            Field(discriminator="result"),
        ]
    )
    receipt = mod.dump_response(DifyBuilderRealCallConsentResponse, _claimed_receipt())
    refusal = {"result": "refusal", "code": "needs_setup", "reason_code": "needs_setup"}

    assert isinstance(adapter.validate_python(receipt), DifyBuilderRealCallConsentResponse)
    assert isinstance(adapter.validate_python(refusal), DifyBuilderRealCallRefusalResponse)
    assert adapter.validate_python(receipt).model_dump(mode="json") == receipt
    refusal_schema = DifyBuilderRealCallRefusalResponse.model_json_schema(mode="serialization")
    assert set(refusal_schema["required"]) == {"result", "code", "reason_code"}
    assert set(refusal_schema["properties"]["code"]["enum"]) == {
        "needs_setup",
        "needs_permission",
        "unsupported_action",
        "unavailable_metadata",
        "conflict",
    }
    with pytest.raises(ValidationError):
        DifyBuilderRealCallRefusalResponse.model_validate(refusal | {"reason_code": "provider said no"})


_CONSENT_METHODS: list[Callable[..., object]] = [
    mod.DifyBuilderRealCallConsentsApi.post,
    mod.DifyBuilderRealCallConsentApi.get,
    mod.DifyBuilderRealCallConsentConfirmApi.post,
    mod.DifyBuilderRealCallConsentExecuteApi.post,
]


@pytest.mark.parametrize("method", _CONSENT_METHODS)
def test_consent_routes_use_the_authenticated_builder_decorator_stack(method: Callable[..., object]) -> None:
    assert _decorator_chain(method) == [
        "setup_required",
        "login_required",
        "account_initialization_required",
        "edit_permission_required",
        "with_current_user",
        "with_current_tenant_id",
        "real_call_without_request_sql",
        "dify_builder_required",
    ]


def test_consent_route_docs_declare_bodies_only_for_posts() -> None:
    expected_bodies = {
        mod.DifyBuilderRealCallConsentsApi.post: "DifyBuilderPrepareRealCallPayload",
        mod.DifyBuilderRealCallConsentConfirmApi.post: "DifyBuilderConfirmRealCallPayload",
        mod.DifyBuilderRealCallConsentExecuteApi.post: "DifyBuilderExecuteRealCallPayload",
    }
    for method, name in expected_bodies.items():
        assert [model.name for model in _apidoc(method)["expect"]] == [name]
    status_doc = _apidoc(mod.DifyBuilderRealCallConsentApi.get)
    assert "expect" not in status_doc
    assert "params" not in status_doc
    success = {
        mod.DifyBuilderRealCallConsentsApi.post: "201",
        mod.DifyBuilderRealCallConsentApi.get: "200",
        mod.DifyBuilderRealCallConsentConfirmApi.post: "200",
        mod.DifyBuilderRealCallConsentExecuteApi.post: "202",
    }
    for method, code in success.items():
        responses = _apidoc(method)["responses"]
        assert responses[code][1].name == "DifyBuilderRealCallConsentResponse"
        # Every 403 that can reach these routes, not only the domain refusal.
        assert responses["403"][1].name == "DifyBuilderRealCallForbiddenResponse"
        assert responses["404"][1].name == "DifyBuilderErrorResponse"
        assert responses["409"][1].name == "DifyBuilderRealCallRefusalResponse"


@pytest.mark.parametrize(
    ("method", "path_kwargs", "body", "service_method", "status"),
    [
        (mod.DifyBuilderRealCallConsentsApi.post, {}, _PREPARE_BODY, "prepare", 201),
        (mod.DifyBuilderRealCallConsentConfirmApi.post, {"consent_id": _CONSENT_ID}, _CONFIRM_BODY, "confirm", 200),
        (mod.DifyBuilderRealCallConsentApi.get, {"consent_id": _CONSENT_ID}, None, "get", 200),
    ],
)
def test_consent_routes_propagate_current_tenant_and_user_through_decorators(
    monkeypatch: pytest.MonkeyPatch,
    method: Callable[..., object],
    path_kwargs: dict[str, str],
    body: dict[str, object] | None,
    service_method: str,
    status: int,
) -> None:
    account = _account("acc-9")
    monkeypatch.setattr(wraps_mod, "current_account_with_tenant", lambda: (account, "ten-9"))
    monkeypatch.setattr(mod.FeatureService, "get_features", lambda _tenant_id: MagicMock(dify_builder_enabled=True))
    consent = _consent_service(monkeypatch)
    getattr(consent, service_method).return_value = _receipt()
    view = unwrap(method, stop=lambda wrapper: "with_current_user" in wrapper.__code__.co_qualname)

    with Flask(__name__).test_request_context(method="GET" if body is None else "POST", json=body):
        result = view(object(), session_id=_SESSION_ID, **path_kwargs)

    assert cast(tuple[dict[str, object], int], result)[1] == status
    called = getattr(consent, service_method).call_args
    assert called.kwargs["actor"] == Actor(account_id="acc-9", tenant_id="ten-9")
    assert called.kwargs["session_id"] == _SESSION_ID


def test_build_service_wires_the_confirmed_consent_owner(monkeypatch: pytest.MonkeyPatch) -> None:
    consent = MagicMock(spec=BuilderRealCallConsentService)
    monkeypatch.setattr(wiring, "build_real_call_consent_service", lambda: consent)
    monkeypatch.setattr(wiring, "sessionmaker", MagicMock())
    monkeypatch.setattr(wiring, "SqlDifyBuilderRepository", MagicMock())
    monkeypatch.setattr(wiring, "WorkflowServiceDifyPort", MagicMock())
    monkeypatch.setattr(wiring, "db", MagicMock())

    service = wiring.build_service()

    assert service._real_call_consent is consent


def test_build_real_call_consent_service_uses_the_shared_engine(monkeypatch: pytest.MonkeyPatch) -> None:
    factory = MagicMock()
    sessionmaker = MagicMock(return_value=factory)
    database = MagicMock()
    monkeypatch.setattr(wiring, "sessionmaker", sessionmaker)
    monkeypatch.setattr(wiring, "db", database)

    consent = wiring.build_real_call_consent_service()

    assert isinstance(consent, BuilderRealCallConsentService)
    assert consent._session_factory is factory
    sessionmaker.assert_called_once_with(bind=database.engine, expire_on_commit=False)


# -- real Flask/RESTX requests through the console blueprint and its error handlers --

_CONSENTS_URL = f"/console/api/dify-builder/sessions/{_SESSION_ID}/real-call-consents"
_CONSENT_URL = f"{_CONSENTS_URL}/{_CONSENT_ID}"
_CONSENT_POSTS: list[tuple[str, dict[str, object]]] = [
    (_CONSENTS_URL, _PREPARE_BODY),
    (f"{_CONSENT_URL}/confirm", _CONFIRM_BODY),
    (f"{_CONSENT_URL}/execute", _EXECUTE_BODY),
]


class _ConsentHttp(NamedTuple):
    client: FlaskClient
    consent: MagicMock
    dispatch: MagicMock


def _consent_http(
    monkeypatch: pytest.MonkeyPatch, *, role: TenantAccountRole = TenantAccountRole.EDITOR, enabled: bool = True
) -> _ConsentHttp:
    """Serve the real console blueprint with the real decorator stack; only identity and owners are faked."""
    apply_config_overrides(monkeypatch, RBAC_ENABLED=False, LOGIN_DISABLED=False)
    monkeypatch.setattr(wraps_mod, "_is_setup_completed", lambda: True)
    monkeypatch.setattr("libs.login.check_csrf_token", lambda _request, _user_id: None)
    monkeypatch.setattr(mod.FeatureService, "get_features", lambda _tenant_id: MagicMock(dify_builder_enabled=enabled))
    consent = MagicMock(spec=BuilderRealCallConsentService)
    dispatch = MagicMock(spec=DifyBuilderService)
    monkeypatch.setattr(mod, "build_real_call_consent_service", lambda: consent)
    monkeypatch.setattr(mod, "build_service", lambda: dispatch)
    account = Account(name="tester", email="tester@example.com")
    account.role = role
    account.status = AccountStatus.ACTIVE
    account._current_tenant = make_tenant(tenant_id="ten-1")
    app = Flask("dify-builder-consent-http")
    app.config["TESTING"] = True
    app.register_blueprint(console_bp)

    def login() -> None:
        g._login_user = account

    app.before_request(login)
    return _ConsentHttp(app.test_client(), consent, dispatch)


@pytest.mark.parametrize("url", [url for url, _body in _CONSENT_POSTS])
@pytest.mark.parametrize(
    ("data", "content_type"),
    [
        ("node_id=tool-1", "application/x-www-form-urlencoded"),
        ("not json", "text/plain"),
        ("", None),
        ('{"scope_digest": ', "application/json"),
        ("{", "application/json"),
    ],
)
def test_consent_posts_reject_non_json_and_malformed_bodies_with_fixed_400(
    monkeypatch: pytest.MonkeyPatch,
    url: str,
    data: str,
    content_type: str | None,
) -> None:
    http = _consent_http(monkeypatch)

    response = http.client.post(url, data=data, content_type=content_type)

    assert response.status_code == 400
    assert response.get_json() == {"code": "bad_request"}
    assert not http.consent.mock_calls
    assert not http.dispatch.mock_calls


@pytest.mark.parametrize(("url", "valid_body"), _CONSENT_POSTS)
def test_consent_posts_reject_json_that_is_not_the_declared_object(
    monkeypatch: pytest.MonkeyPatch, url: str, valid_body: dict[str, object]
) -> None:
    http = _consent_http(monkeypatch)

    bodies: list[object] = [[], [valid_body], "text", 7, valid_body | {"guard": {}}]
    for body in bodies:
        response = http.client.post(url, json=body)
        assert response.status_code == 400
        assert response.get_json() == {"code": "bad_request"}
    assert not http.consent.mock_calls
    assert not http.dispatch.mock_calls


def test_consent_prepare_json_request_reaches_only_the_consent_owner(monkeypatch: pytest.MonkeyPatch) -> None:
    http = _consent_http(monkeypatch)
    http.consent.prepare.return_value = _receipt()

    response = http.client.post(_CONSENTS_URL, json=_PREPARE_BODY)

    assert response.status_code == 201
    assert response.get_json()["consent_id"] == _CONSENT_ID
    assert http.consent.prepare.call_args.kwargs["actor"].tenant_id == "ten-1"
    assert not http.dispatch.mock_calls


_ALL_CONSENT_REQUESTS: list[tuple[str, str, dict[str, object] | None]] = [
    ("POST", _CONSENTS_URL, _PREPARE_BODY),
    ("GET", _CONSENT_URL, None),
    ("POST", f"{_CONSENT_URL}/confirm", _CONFIRM_BODY),
    ("POST", f"{_CONSENT_URL}/execute", _EXECUTE_BODY),
]


@pytest.mark.parametrize(("method", "url", "body"), _ALL_CONSENT_REQUESTS)
def test_inherited_edit_permission_guard_403_shape(
    monkeypatch: pytest.MonkeyPatch, method: str, url: str, body: dict[str, object] | None
) -> None:
    http = _consent_http(monkeypatch, role=TenantAccountRole.NORMAL)

    response = http.client.open(url, method=method, json=body)

    assert response.status_code == 403
    assert response.get_json() == {"code": "forbidden", "message": Forbidden.description, "status": 403}
    DifyBuilderRealCallForbiddenResponse.model_validate(response.get_json())
    assert not http.consent.mock_calls
    assert not http.dispatch.mock_calls


@pytest.mark.parametrize(("method", "url", "body"), _ALL_CONSENT_REQUESTS)
def test_inherited_feature_gate_403_shape(
    monkeypatch: pytest.MonkeyPatch, method: str, url: str, body: dict[str, object] | None
) -> None:
    http = _consent_http(monkeypatch, enabled=False)

    response = http.client.open(url, method=method, json=body)

    assert response.status_code == 403
    assert response.get_json() == {"code": "feature_unavailable"}
    DifyBuilderRealCallForbiddenResponse.model_validate(response.get_json())
    assert not http.consent.mock_calls
    assert not http.dispatch.mock_calls


def test_domain_permission_refusal_403_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    http = _consent_http(monkeypatch)
    http.consent.get.side_effect = BuilderExecutionPolicyError("execution_permission_denied")
    http.dispatch.execute_confirmed_tool.side_effect = Forbidden()

    status = http.client.get(_CONSENT_URL)
    execute = http.client.post(f"{_CONSENT_URL}/execute", json=_EXECUTE_BODY)

    refusal = {"result": "refusal", "code": "needs_permission", "reason_code": "execution_permission_denied"}
    assert (status.status_code, status.get_json()) == (403, refusal)
    assert (execute.status_code, execute.get_json()) == (403, refusal)
    DifyBuilderRealCallForbiddenResponse.model_validate(refusal)


def test_documented_403_union_accepts_exactly_the_real_403_bodies() -> None:
    bodies: list[dict[str, object]] = [
        {"code": "forbidden", "message": Forbidden.description, "status": 403},
        {"code": "feature_unavailable"},
        {"result": "refusal", "code": "needs_permission", "reason_code": "execution_permission_denied"},
    ]
    for body in bodies:
        assert DifyBuilderRealCallForbiddenResponse.model_validate(body).model_dump(mode="json") == body
    # The narrowed domain refusal cannot carry any other category or reason.
    for loose in (
        {"result": "refusal", "code": "needs_permission", "reason_code": "needs_setup"},
        {"result": "refusal", "code": "conflict", "reason_code": "execution_permission_denied"},
        {"code": "forbidden", "message": "x", "status": 404},
        {"code": "not_found"},
    ):
        with pytest.raises(ValidationError):
            DifyBuilderRealCallForbiddenResponse.model_validate(loose)
    schema = DifyBuilderRealCallForbiddenResponse.model_json_schema(mode="serialization")
    assert set(schema["discriminator"]["mapping"]) == {"forbidden", "feature_unavailable", "needs_permission"}


# -- request SQL lifetime at the dispatch coordinator's external boundaries --


class _OpenTransactions:
    """Connection-level transactions currently open on an engine (any session, any owner)."""

    def __init__(self, engine: Engine) -> None:
        self.count = 0
        self._engine = engine
        event.listen(engine, "begin", self._begin)
        event.listen(engine, "commit", self._end)
        event.listen(engine, "rollback", self._end)

    def _begin(self, _conn: object) -> None:
        self.count += 1

    def _end(self, _conn: object) -> None:
        self.count = max(0, self.count - 1)

    def close(self) -> None:
        event.remove(self._engine, "begin", self._begin)
        event.remove(self._engine, "commit", self._end)
        event.remove(self._engine, "rollback", self._end)


class _RequestSqlWorld(NamedTuple):
    client: FlaskClient
    registry: scoped_session[OrmSession]
    witness: _OpenTransactions
    consent: MagicMock
    boundaries: list[tuple[str, bool, int]]
    enqueued: list[tuple[str, Action, Actor, str]]
    # Per request, just before teardown removes the session: (scoped transaction open,
    # staged write visible to it, staged write visible to any other session).
    teardown: list[tuple[bool, bool, bool]]


_STAGED = select(DifySetup.version).where(DifySetup.version == "staged-by-another-owner")


@pytest.fixture
def request_sql_world(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[_RequestSqlWorld]:
    """The real consent routes, decorator stack, uncached setup read and production authorizer on real SQL.

    ``db`` of the console wraps, the controller and the wiring is one real ``scoped_session`` over
    SQLite (the unit app does not initialize Flask-SQLAlchemy); request teardown removes it, as the
    extension does. Identity is injected the same way as ``_consent_http``. The Redis advance lease
    and the consent owner are boundary spies that record, at each external call, whether the
    request-scoped session is in a transaction and how many connection transactions are open.
    """
    engine = create_engine(f"sqlite:///{tmp_path / 'request-sql.sqlite3'}")
    Base.metadata.create_all(engine)
    TypeBase.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    registry = scoped_session(factory)
    database = SimpleNamespace(session=registry, engine=engine)
    monkeypatch.setattr(session_factory_module, "_session_maker", factory)
    monkeypatch.setattr(wraps_mod, "db", database)
    monkeypatch.setattr(wiring, "db", database)
    monkeypatch.setattr(rbac_locators, "db", database)
    monkeypatch.setattr(mod, "db", database, raising=False)
    apply_config_overrides(monkeypatch, RBAC_ENABLED=False, LOGIN_DISABLED=False)
    monkeypatch.setattr("libs.login.check_csrf_token", lambda _request, _user_id: None)
    with factory.begin() as session:
        account = Account(name="tester", email="tester@example.com")
        session.add(account)
        session.flush()
        session.add(DifySetup(version="unit"))
        session.add(
            App(
                id="app-1",
                tenant_id="ten-1",
                mode="workflow",
                name="Builder app",
                tracing=None,
                enable_site=False,
                enable_api=False,
            )
        )
        session.add(TenantAccountJoin(tenant_id="ten-1", account_id=account.id, role=TenantAccountRole.EDITOR))
    account.role = TenantAccountRole.EDITOR
    account.status = AccountStatus.ACTIVE
    account._current_tenant = make_tenant(tenant_id="ten-1")
    witness = _OpenTransactions(engine)
    boundaries: list[tuple[str, bool, int]] = []

    def observe(name: str) -> None:
        boundaries.append((name, registry().in_transaction(), witness.count))

    def features(_tenant_id: str) -> MagicMock:
        # The feature gate's billing/enterprise read: the first external boundary after the auth wrappers.
        observe("feature")
        return MagicMock(dify_builder_enabled=True)

    monkeypatch.setattr(mod.FeatureService, "get_features", features)

    class _ObservedLease(_HeldLease):
        @override
        def acquire(self, session_id: str) -> str | None:
            observe("lease_acquire")
            return super().acquire(session_id)

        @override
        def release(self, session_id: str, token: str) -> None:
            observe("lease_release")
            super().release(session_id, token)

    consent = MagicMock(spec=BuilderRealCallConsentService)
    repo = MagicMock(spec=Repository)
    repo.get_session.return_value = (
        DomainSession(
            id=_SESSION_ID,
            app_id="app-1",
            tenant_id="ten-1",
            owner_account_id=account.id,
            entry_mode=EntryMode.BUILD,
            current_state=PcState.BUILD_REVIEW,
            version=3,
        ),
        DifyBuilderContext(),
    )
    enqueued: list[tuple[str, Action, Actor, str]] = []

    def enqueue(session_id: str, action: Action, actor: Actor, token: str) -> None:
        observe("enqueue")
        enqueued.append((session_id, action, actor, token))

    service = DifyBuilderService(
        cast(Repository, repo),
        _ObservedLease(),
        enqueue,
        authorize_app_fn=wiring._authorize_app,
        real_call_consent=cast(BuilderRealCallConsentService, consent),
    )
    monkeypatch.setattr(mod, "build_service", lambda: service)
    monkeypatch.setattr(mod, "build_real_call_consent_service", lambda: consent)
    app = Flask("dify-builder-request-sql")
    app.config["TESTING"] = True
    app.register_blueprint(console_bp)

    def login() -> None:
        g._login_user = account

    app.before_request(login)
    teardown: list[tuple[bool, bool, bool]] = []

    def capture(_error: BaseException | None) -> None:
        scoped = registry()
        open_transaction = scoped.in_transaction()
        if open_transaction:
            with factory() as other:
                teardown.append((True, scoped.scalar(_STAGED) is not None, other.scalar(_STAGED) is not None))
        else:
            teardown.append((False, False, False))

    # Teardown functions run in reverse registration order: capture, then remove (as the extension does).
    app.teardown_request(lambda _error: registry.remove())
    app.teardown_request(capture)
    # Uncached: the real first ``_is_setup_completed`` must close its owned DifySetup read.
    setup_check = wraps_mod._is_setup_completed
    setup_check.reset_success()
    try:
        yield _RequestSqlWorld(app.test_client(), registry, witness, consent, boundaries, enqueued, teardown)
    finally:
        setup_check.reset_success()
        witness.close()
        registry.remove()
        engine.dispose()


def _observed_consent(world: _RequestSqlWorld, name: str, result: object) -> Callable[..., object]:
    def call(**_kwargs: object) -> object:
        world.boundaries.append((name, world.registry().in_transaction(), world.witness.count))
        if isinstance(result, BaseException):
            raise result
        return result

    return call


@pytest.fixture
def enabled_rbac(
    request: pytest.FixtureRequest, request_sql_world: _RequestSqlWorld, monkeypatch: pytest.MonkeyPatch
) -> dict[RBACPermission, bool]:
    """Keep the real locator/evaluator; replace only the external access RPC with a witness."""
    world = request_sql_world
    enabled = getattr(request, "param", True)
    apply_config_overrides(monkeypatch, RBAC_ENABLED=enabled)
    permissions = {RBACPermission.APP_EDIT: True, RBACPermission.APP_TEST_AND_RUN: True} if enabled else {}

    def check(
        tenant_id: str, account_id: str, *, scene: RBACPermission, resource_type: str | None, resource_id: str | None
    ) -> bool:
        assert tenant_id == "ten-1"
        assert account_id
        assert (resource_type, resource_id) == ("app", "app-1")
        world.boundaries.append((f"rbac:{scene.value}", world.registry().in_transaction(), world.witness.count))
        return permissions[scene]

    monkeypatch.setattr(RBACService.CheckAccess, "check", check)
    return permissions


@pytest.mark.parametrize("enabled_rbac", [False, True], ids=["legacy", "rbac"], indirect=True)
def test_execute_request_holds_no_sql_at_the_lease_reservation_or_enqueue(
    request_sql_world: _RequestSqlWorld, enabled_rbac: dict[RBACPermission, bool]
) -> None:
    world = request_sql_world
    world.consent.reserve_execution.side_effect = _observed_consent(world, "reserve", (_reserved_receipt(), True))
    world.consent.replay_execution.side_effect = _observed_consent(world, "replay", _claimed_receipt())

    first = world.client.post(f"{_CONSENT_URL}/execute", json=_EXECUTE_BODY)
    # The lease is still held: a matching duplicate is answered by the replay owner.
    replay = world.client.post(f"{_CONSENT_URL}/execute", json=_EXECUTE_BODY)

    assert (first.status_code, replay.status_code) == (202, 202)
    assert len(world.enqueued) == 1
    rbac: list[str] = ["rbac:app_edit", "rbac:app_test_and_run"] if enabled_rbac else []
    assert [name for name, _scoped, _open in world.boundaries] == [
        "feature",
        *rbac,
        "lease_acquire",
        "reserve",
        "enqueue",
        "feature",
        *rbac,
        "lease_acquire",
        "replay",
    ]
    # No request-scoped (wrapper/authorizer) or other SQL transaction at any external boundary.
    assert [(name, scoped, count) for name, scoped, count in world.boundaries if scoped or count] == []


@pytest.mark.parametrize("enabled_rbac", [False, True], ids=["legacy", "rbac"], indirect=True)
def test_execute_refusal_holds_no_sql_at_the_lease_or_reservation(
    request_sql_world: _RequestSqlWorld, enabled_rbac: dict[RBACPermission, bool]
) -> None:
    world = request_sql_world
    world.consent.reserve_execution.side_effect = _observed_consent(
        world, "reserve", BuilderExecutionPolicyError("consent_scope_mismatch")
    )

    refused = world.client.post(f"{_CONSENT_URL}/execute", json=_EXECUTE_BODY)

    assert refused.status_code == 409
    assert refused.get_json()["reason_code"] == "consent_scope_mismatch"
    assert world.enqueued == []
    assert [name for name, _scoped, _open in world.boundaries] == [
        "feature",
        *(["rbac:app_edit", "rbac:app_test_and_run"] if enabled_rbac else []),
        "lease_acquire",
        "reserve",
        "lease_release",
    ]
    assert [(name, scoped, count) for name, scoped, count in world.boundaries if scoped or count] == []


@pytest.mark.parametrize("denied", [RBACPermission.APP_EDIT, RBACPermission.APP_TEST_AND_RUN])
def test_execute_rbac_denial_holds_no_sql_and_stops_before_the_lease(
    request_sql_world: _RequestSqlWorld, enabled_rbac: dict[RBACPermission, bool], denied: RBACPermission
) -> None:
    world = request_sql_world
    enabled_rbac[denied] = False

    response = world.client.post(f"{_CONSENT_URL}/execute", json=_EXECUTE_BODY)

    assert response.status_code == 403
    assert world.enqueued == []
    scenes = ["rbac:app_edit"] if denied is RBACPermission.APP_EDIT else ["rbac:app_edit", "rbac:app_test_and_run"]
    assert world.boundaries == [(name, False, 0) for name in ["feature", *scenes]]


def test_execute_rbac_maintainer_shortcut_preserves_permission_semantics(
    request_sql_world: _RequestSqlWorld, enabled_rbac: dict[RBACPermission, bool]
) -> None:
    world = request_sql_world
    enabled_rbac.update(dict.fromkeys(enabled_rbac, False))
    with sessionmaker(bind=world.registry.get_bind()).begin() as session:
        app = session.get(App, "app-1")
        assert app is not None
        app.maintainer = session.scalar(
            select(TenantAccountJoin.account_id).where(TenantAccountJoin.tenant_id == "ten-1")
        )
    world.consent.reserve_execution.side_effect = _observed_consent(world, "reserve", (_reserved_receipt(), True))

    response = world.client.post(f"{_CONSENT_URL}/execute", json=_EXECUTE_BODY)

    assert response.status_code == 202
    assert len(world.enqueued) == 1
    assert world.boundaries == [(name, False, 0) for name in ["feature", "lease_acquire", "reserve", "enqueue"]]


@pytest.mark.parametrize(
    ("method", "url", "body", "owner_call"),
    [
        ("POST", _CONSENTS_URL, _PREPARE_BODY, "prepare"),
        ("POST", f"{_CONSENT_URL}/confirm", _CONFIRM_BODY, "confirm"),
        ("GET", _CONSENT_URL, None, "get"),
    ],
)
def test_consent_owner_calls_start_without_request_sql(
    request_sql_world: _RequestSqlWorld, method: str, url: str, body: dict[str, object] | None, owner_call: str
) -> None:
    """The consent owner reads external metadata first; the wrappers' request reads must be over."""
    world = request_sql_world
    getattr(world.consent, owner_call).side_effect = _observed_consent(world, owner_call, _receipt())

    response = world.client.open(url, method=method, json=body)

    assert response.status_code in (200, 201)
    assert world.boundaries == [("feature", False, 0), (owner_call, False, 0)]


@pytest.mark.parametrize("write", ["orm_flushed", "core_dml", "orm_pending"])
@pytest.mark.parametrize("enabled_rbac", [False, True], ids=["legacy", "rbac"], indirect=True)
@pytest.mark.usefixtures("enabled_rbac")
def test_another_owners_request_write_is_preserved_and_refused(
    request_sql_world: _RequestSqlWorld,
    monkeypatch: pytest.MonkeyPatch,
    write: str,
) -> None:
    """A real-call request never commits or rolls back a request transaction holding another owner's write.

    The write is staged before the guard (already flushed, Core DML, or still pending); the request
    is refused before any external boundary and the write is still exactly in the open request
    transaction at request teardown, invisible to any other session.
    """
    world = request_sql_world
    original = wraps_mod._is_setup_completed

    def stage_then_check_setup() -> bool:
        if write == "orm_flushed":
            world.registry.add(DifySetup(version="staged-by-another-owner"))
            world.registry.flush()
        elif write == "core_dml":
            world.registry.execute(insert(DifySetup).values(version="staged-by-another-owner"))
        else:
            world.registry.add(DifySetup(version="staged-by-another-owner"))
        return original()

    monkeypatch.setattr(wraps_mod, "_is_setup_completed", stage_then_check_setup)
    world.consent.reserve_execution.side_effect = _observed_consent(world, "reserve", (_reserved_receipt(), True))

    refused = world.client.post(f"{_CONSENT_URL}/execute", json=_EXECUTE_BODY)

    # The guard's RuntimeError is the framework's generic 500; nothing external ran.
    assert refused.status_code == 500
    assert world.boundaries == []
    assert world.enqueued == []
    # Captured at request teardown, before the extension's own removal: neither ended nor committed.
    assert world.teardown == [(True, True, False)]
