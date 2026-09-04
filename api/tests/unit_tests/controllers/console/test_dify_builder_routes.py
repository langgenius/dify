"""Unit tests for the Dify Builder console JSON and SSE routes.

The module-level route functions are deliberately undecorated, so these tests
exercise request validation, pre-stream error mapping, and stream construction
without requiring a logged-in Flask request context.
"""

import json
from inspect import unwrap
from unittest.mock import MagicMock

import pytest
from flask import Response

import controllers.console.dify_builder as mod
from controllers.console import wraps as wraps_mod
from core.dify_builder.contract import ConversationPage, RunStatus
from core.dify_builder.errors import ConflictError, NotFoundError
from core.dify_builder.models import Actor, ConversationItem
from services.dify_builder.service import SessionView


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
            {"app_id": "a1", "goal_text": "Build it", "model_config": None},
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
    ],
)
def test_session_routes_require_legacy_edit_permission(method):
    gate = unwrap(method, stop=lambda wrapper: "edit_permission_required" in wrapper.__code__.co_qualname)
    assert "edit_permission_required" in gate.__code__.co_qualname
