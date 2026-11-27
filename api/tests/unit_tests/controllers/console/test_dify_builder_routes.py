"""Unit tests for the Dify Builder console JSON and SSE routes.

The module-level route functions are deliberately undecorated, so these tests
exercise request validation, pre-stream error mapping, and stream construction
without requiring a logged-in Flask request context.
"""

import json
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from inspect import unwrap
from pathlib import Path
from types import FunctionType
from typing import NamedTuple, NoReturn, Self, override

import pytest
import pytest_mock
from flask import Flask, Response, current_app, has_request_context
from flask.testing import FlaskClient
from flask_restx.model import SchemaModel
from sqlalchemy import Engine, create_engine, event, select
from sqlalchemy.orm import Session as OrmSession
from sqlalchemy.orm import scoped_session, sessionmaker
from werkzeug.exceptions import Forbidden, HTTPException

import controllers.console.dify_builder as mod
import core.db.session_factory as session_factory_module
from constants import COOKIE_NAME_CSRF_TOKEN, HEADER_NAME_CSRF_TOKEN
from controllers.common.rbac import RBACPermission
from controllers.console import bp as console_bp
from controllers.console import wraps as wraps_mod
from controllers.console.dify_builder_fields import (
    DifyBuilderSessionViewResponse,
)
from core.dify_builder.contract import ConversationPage, RunStatus
from core.dify_builder.errors import BusyError, ConflictError, ModelUnavailableError, NotFoundError
from core.dify_builder.models import (
    Action,
    Actor,
    ConversationItem,
    DifyBuilderContext,
    EntryMode,
)
from core.dify_builder.models import Session as DomainSession
from core.dify_builder.state import PcState
from enums import DeploymentEdition
from extensions.ext_application_services import init_app as init_application_services
from extensions.ext_login import login_manager
from libs.passport import PassportService
from libs.token import _real_cookie_name, generate_csrf_token
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.base import Base, TypeBase
from models.model import App, AppMode, DifySetup
from services.dify_builder import wiring
from services.dify_builder.repository import SqlDifyBuilderRepository
from services.dify_builder.service import CommandSubmission, DifyBuilderService, SessionView
from services.enterprise.rbac_service import RBACService
from services.entities.feature_entities import FeatureModel
from tests.helpers.unit.config_override import apply_config_overrides
from tests.unit_tests.installed_spies import installed_mock


@dataclass
class _RouteDatabase:
    session: scoped_session[OrmSession]
    engine: Engine


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


def _account(account_id: str = "acc-1") -> Account:
    account = Account(name="Actor", email=f"{account_id}@example.test")
    account.id = account_id
    return account


def _actor() -> Actor:
    return mod._actor(_account(), "ten-1")


def _route_service() -> DifyBuilderService:
    return DifyBuilderService(
        repo=SqlDifyBuilderRepository(session_factory_module.get_session_maker()),
        session_lock=_HeldLease(),
        enqueue_fn=lambda _session_id, _action, _actor, _token: None,
    )


class _ProgressSubscription:
    """An idle, closeable progress subscription for reconnect transport tests."""

    def __init__(self) -> None:
        self.closed = False

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_error: object) -> None:
        self.close()

    def __iter__(self) -> Iterator[bytes]:
        return iter(())

    def receive(self, timeout: float | None = 0.1) -> bytes | None:
        del timeout
        return None

    def close(self) -> None:
        self.closed = True


def _assert_event_stream(result: object) -> Response:
    assert isinstance(result, Response)
    assert result.mimetype == "text/event-stream"
    assert result.headers["Cache-Control"] == "no-cache"
    assert result.headers["X-Accel-Buffering"] == "no"
    return result


def test_conversation_get_validates_query_and_returns_json_page(
    mocker: pytest_mock.MockerFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = _route_service()
    mocker.patch.object(service, "get_conversation_page")
    _installed_spy_3 = installed_mock(service.get_conversation_page)
    _installed_spy_3.return_value = ConversationPage(
        data=[ConversationItem(seq=2, kind="notice", payload={"text": "hi"}, at_version=2)],
        has_more=True,
        first_seq=2,
        last_seq=2,
    )
    monkeypatch.setattr(mod, "build_service", lambda: service)

    response = mod._conversation("s1", {"before_seq": "3", "limit": "10"}, _actor())

    assert response == {
        "data": [
            {
                "seq": 2,
                "at_version": 2,
                "kind": "notice",
                "payload": {"text": "hi", "tone": "neutral", "reply_language": ""},
            }
        ],
        "has_more": True,
        "first_seq": 2,
        "last_seq": 2,
    }
    _installed_spy_4 = installed_mock(service.get_conversation_page)
    _installed_spy_4.assert_called_once_with(
        "s1",
        _actor(),
        limit=10,
        before_seq=3,
        after_seq=None,
    )


def test_conversation_get_rejects_competing_cursors(
    mocker: pytest_mock.MockerFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = _route_service()
    mocker.patch.object(service, "get_conversation_page")
    monkeypatch.setattr(mod, "build_service", lambda: service)

    assert mod._conversation("s1", {"before_seq": "3", "after_seq": "1"}, _actor()) == (
        {"code": "bad_request"},
        400,
    )
    _installed_spy_5 = installed_mock(service.get_conversation_page)
    _installed_spy_5.assert_not_called()


@pytest.mark.parametrize(
    ("payload", "method_name", "expected_kwargs"),
    [
        (
            {"scenario": "build", "app_id": "a1", "goal_text": "Build it"},
            "prepare_build_session",
            {"app_id": "a1", "goal_text": "Build it", "model_config": None},
        ),
        (
            {"scenario": "edit", "app_id": "a1", "goal_text": "Tighten risk"},
            "prepare_edit_session",
            {"app_id": "a1", "goal_text": "Tighten risk", "model_config": None},
        ),
        (
            {"scenario": "fix", "app_id": "a1", "failed_run_id": "TR-1"},
            "prepare_fix_session",
            {
                "app_id": "a1",
                "failed_run_id": "TR-1",
                "checklist_errors": None,
                "defer_existing": True,
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
            "prepare_fix_session",
            {
                "app_id": "a1",
                "failed_run_id": None,
                "defer_existing": True,
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
def test_create_persists_session_without_dispatching(
    mocker: pytest_mock.MockerFixture,
    monkeypatch: pytest.MonkeyPatch,
    payload: object,
    method_name: str,
    expected_kwargs: dict[str, object],
) -> None:
    service = _route_service()
    mocker.patch.object(service, "create_build_session")
    mocker.patch.object(service, "create_edit_session")
    mocker.patch.object(service, "create_fix_session")
    prepare = mocker.patch.object(service, method_name, return_value=("s1", Action()))
    mocker.patch.object(service, "get_session_view", return_value=_session_view())
    monkeypatch.setattr(mod, "build_service", lambda: service)
    actor = _actor()

    response = mod._create(payload, actor)

    assert isinstance(response, dict)
    assert response["session"]["session_id"] == "s1"
    assert response["requires_start"] is True
    called = prepare.call_args
    assert called.kwargs == {**expected_kwargs, "actor": actor}
    _installed_spy_6 = installed_mock(service.create_build_session)
    _installed_spy_6.assert_not_called()
    _installed_spy_7 = installed_mock(service.create_edit_session)
    _installed_spy_7.assert_not_called()
    _installed_spy_8 = installed_mock(service.create_fix_session)
    _installed_spy_8.assert_not_called()


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
def test_create_rejects_malformed_or_legacy_payload_before_service(
    mocker: pytest_mock.MockerFixture, monkeypatch: pytest.MonkeyPatch, payload: object
) -> None:
    service = _route_service()
    mocker.patch.object(service, "prepare_build_session")
    mocker.patch.object(service, "prepare_edit_session")
    mocker.patch.object(service, "prepare_fix_session")
    mocker.patch.object(service, "submit_message_command")
    mocker.patch.object(service, "submit_action_command")
    monkeypatch.setattr(mod, "build_service", lambda: service)

    assert mod._create(payload, _actor()) == ({"code": "bad_request"}, 400)
    assert not any(
        installed_mock(method).called
        for method in (
            service.prepare_build_session,
            service.prepare_edit_session,
            service.prepare_fix_session,
            service.submit_message_command,
            service.submit_action_command,
        )
    )


def test_create_returns_recoverable_model_error(
    mocker: pytest_mock.MockerFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = _route_service()
    mocker.patch.object(service, "prepare_build_session")
    _installed_spy_12 = installed_mock(service.prepare_build_session)
    _installed_spy_12.side_effect = ModelUnavailableError("provider credential detail")
    monkeypatch.setattr(mod, "build_service", lambda: service)

    result = mod._create({"scenario": "build", "app_id": "a1", "goal_text": "Build it"}, _actor())

    assert result == (
        {"code": "model_unavailable", "message": "Builder model is unavailable", "recoverable": True},
        400,
    )


def test_action_returns_admission_receipt_and_resolves_action_id(
    mocker: pytest_mock.MockerFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = _route_service()
    mocker.patch.object(service, "submit_action")
    mocker.patch.object(service, "submit_action_command")
    _installed_spy_13 = installed_mock(service.submit_action_command)
    _installed_spy_13.return_value = CommandSubmission("command-1", pending=True)
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

    assert response == {"command_id": "command-1", "pending": True, "session": None}
    _installed_spy_14 = installed_mock(service.submit_action_command)
    called_session_id, called_actor, action = _installed_spy_14.call_args.args
    assert (called_session_id, called_actor) == ("s1", actor)
    assert action.kind == "run_verify"
    assert action.payload == {"scope": "changed"}
    assert action.base_version == 1
    assert action.base_app_revision == "hash-1"
    _installed_spy_15 = installed_mock(service.submit_action)
    _installed_spy_15.assert_not_called()


def test_action_keeps_receipt_snapshot_separate_from_raw_submission(
    mocker: pytest_mock.MockerFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = _route_service()
    mocker.patch.object(service, "submit_action_command")
    _installed_spy_16 = installed_mock(service.submit_action_command)
    _installed_spy_16.return_value = CommandSubmission("command-1", pending=True)
    monkeypatch.setattr(mod, "build_service", lambda: service)
    raw = {"goal": "Goal {{name}} <tag>", "enabled": True}
    snapshot = {
        "interaction_kind": "form",
        "reply_language": "zh-Hans",
        "question": "核对需求",
        "answer": "",
        "fields": [
            {"key": "goal", "label": "目标", "display_value": raw["goal"]},
            {"key": "enabled", "label": "启用", "display_value": "是"},
        ],
    }

    response = mod._action(
        "s1",
        {
            "action_id": "submit_requirements",
            "payload": raw,
            "receipt_snapshot": snapshot,
            "base_version": 1,
            "base_app_revision": "hash-1",
        },
        _actor(),
    )

    assert response == {"command_id": "command-1", "pending": True, "session": None}
    _installed_spy_17 = installed_mock(service.submit_action_command)
    action: Action = _installed_spy_17.call_args.args[2]
    assert action.payload == raw
    assert action.receipt_snapshot == snapshot


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
def test_action_rejects_malformed_or_legacy_payload_before_service(
    mocker: pytest_mock.MockerFixture, monkeypatch: pytest.MonkeyPatch, payload: object
) -> None:
    service = _route_service()
    mocker.patch.object(service, "prepare_build_session")
    mocker.patch.object(service, "prepare_edit_session")
    mocker.patch.object(service, "prepare_fix_session")
    mocker.patch.object(service, "submit_message_command")
    mocker.patch.object(service, "submit_action_command")
    monkeypatch.setattr(mod, "build_service", lambda: service)

    assert mod._action("s1", payload, _actor()) == ({"code": "bad_request"}, 400)
    assert not any(
        installed_mock(method).called
        for method in (
            service.prepare_build_session,
            service.prepare_edit_session,
            service.prepare_fix_session,
            service.submit_message_command,
            service.submit_action_command,
        )
    )


def test_action_maps_admission_conflict(mocker: pytest_mock.MockerFixture, monkeypatch: pytest.MonkeyPatch) -> None:
    service = _route_service()
    mocker.patch.object(service, "submit_action_command")
    _installed_spy_18 = installed_mock(service.submit_action_command)
    _installed_spy_18.side_effect = ConflictError("stale")
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


def test_message_returns_admission_receipt(mocker: pytest_mock.MockerFixture, monkeypatch: pytest.MonkeyPatch) -> None:
    service = _route_service()
    mocker.patch.object(service, "submit_message")
    mocker.patch.object(service, "submit_message_command")
    _installed_spy_19 = installed_mock(service.submit_message_command)
    _installed_spy_19.return_value = CommandSubmission("command-1", pending=True)
    monkeypatch.setattr(mod, "build_service", lambda: service)
    actor = _actor()

    response = mod._message(
        "s1",
        {"text": "hi", "base_version": 2, "client_turn_id": "turn-1"},
        actor,
    )

    assert response == {"command_id": "command-1", "pending": True, "session": None}
    _installed_spy_20 = installed_mock(service.submit_message_command)
    _installed_spy_20.assert_called_once_with("s1", actor, "hi", 2, "turn-1")
    _installed_spy_21 = installed_mock(service.submit_message)
    _installed_spy_21.assert_not_called()


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
def test_message_rejects_malformed_or_legacy_payload_before_service(
    mocker: pytest_mock.MockerFixture, monkeypatch: pytest.MonkeyPatch, payload: object
) -> None:
    service = _route_service()
    mocker.patch.object(service, "prepare_build_session")
    mocker.patch.object(service, "prepare_edit_session")
    mocker.patch.object(service, "prepare_fix_session")
    mocker.patch.object(service, "submit_message_command")
    mocker.patch.object(service, "submit_action_command")
    monkeypatch.setattr(mod, "build_service", lambda: service)

    assert mod._message("s1", payload, _actor()) == ({"code": "bad_request"}, 400)
    assert not any(
        installed_mock(method).called
        for method in (
            service.prepare_build_session,
            service.prepare_edit_session,
            service.prepare_fix_session,
            service.submit_message_command,
            service.submit_action_command,
        )
    )


def test_stream_authorizes_then_subscribes_before_reading_state(
    mocker: pytest_mock.MockerFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[str] = []
    subscription = _ProgressSubscription()
    mocker.spy(subscription, "close")
    service = _route_service()
    mocker.patch.object(service, "authorize_session")
    mocker.patch.object(service, "get_session_view")

    _installed_spy_22 = installed_mock(service.authorize_session)
    _installed_spy_22.side_effect = lambda *_args: calls.append("authorize")
    _installed_spy_23 = installed_mock(service.get_session_view)
    processing = _session_view()
    processing.command_pending = True
    _installed_spy_23.side_effect = lambda *_args: (calls.append("view"), processing)[1]

    def read_snapshot(*, tenant_id: str, session_id: str) -> None:
        assert (tenant_id, session_id) == ("ten-1", "s1")
        calls.append("snapshot")

    def subscribe(_session_id: str) -> _ProgressSubscription:
        calls.append("subscribe")
        return subscription

    stream = mocker.patch.object(mod, "stream_session_frames", return_value=iter(["data: {}\n\n"]))
    monkeypatch.setattr(mod, "build_service", lambda: service)
    monkeypatch.setattr(mod.progress_bus, "subscribe", subscribe)
    monkeypatch.setattr(mod.progress_snapshot, "read", read_snapshot)

    with Flask(__name__).app_context():
        response = mod._stream("s1", _actor())

    _assert_event_stream(response)
    assert calls == ["authorize", "subscribe", "view", "snapshot"]
    assert stream.call_args.args[0]["command_pending"] is True
    assert stream.call_args.args[1] is subscription


def test_reconnect_heartbeat_recovers_without_retaining_the_request_context(
    mocker: pytest_mock.MockerFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    app = Flask(__name__)
    processing = _session_view()
    processing.command_pending = True
    settled = _session_view(run_status=RunStatus.WAITING_INPUT)
    settled.last_command_id = "command-1"
    service = _route_service()
    service._repo.create_session(
        DomainSession(
            id="s1",
            app_id="app-1",
            tenant_id="ten-1",
            owner_account_id="acc-1",
            entry_mode=EntryMode.BUILD,
            current_state=PcState.BUILD_GOAL_ANALYSIS,
        ),
        DifyBuilderContext(),
        [],
    )
    mocker.patch.object(service, "authorize_session", return_value=None)
    mocker.patch.object(service, "get_session_view")
    subscription = _ProgressSubscription()
    mocker.spy(subscription, "close")

    def read_view(_session_id: str, actor: Actor) -> SessionView:
        assert current_app == app
        assert actor == _actor()
        if installed_mock(service.get_session_view).call_count == 1:
            return processing
        assert not has_request_context()
        return settled

    _installed_spy_25 = installed_mock(service.get_session_view)
    _installed_spy_25.side_effect = read_view
    monkeypatch.setattr(mod, "build_service", lambda: service)
    monkeypatch.setattr(mod.progress_bus, "subscribe", lambda _session_id: subscription)
    monkeypatch.setattr(mod.progress_snapshot, "read", lambda **_kwargs: None)

    with app.test_request_context():
        response = _assert_event_stream(mod._stream("s1", _actor()))

    chunks = response.iter_encoded()
    assert json.loads(next(chunks).splitlines()[1].removeprefix(b"data: "))["event"] == "session_ready"
    event = json.loads(next(chunks).splitlines()[1].removeprefix(b"data: "))
    assert event["event"] == "session_state"
    assert event["data"]["run_status"] == "waiting_input"
    assert event["data"]["last_command_id"] == "command-1"
    response.close()
    _installed_spy_26 = installed_mock(service.get_session_view)
    assert _installed_spy_26.call_count == 2
    _installed_spy_27 = installed_mock(subscription.close)
    assert subscription.closed


def test_stream_closes_subscription_when_state_is_unavailable(
    mocker: pytest_mock.MockerFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    subscription = _ProgressSubscription()
    mocker.spy(subscription, "close")
    service = _route_service()
    mocker.patch.object(service, "authorize_session", return_value=None)
    mocker.patch.object(service, "get_session_view")
    _installed_spy_28 = installed_mock(service.get_session_view)
    _installed_spy_28.side_effect = NotFoundError("missing")
    monkeypatch.setattr(mod.progress_bus, "subscribe", lambda _session_id: subscription)
    monkeypatch.setattr(mod, "build_service", lambda: service)

    result = mod._stream("s1", _actor())

    assert result == ({"code": "not_found"}, 404)
    _installed_spy_29 = installed_mock(subscription.close)
    _installed_spy_29.assert_called_once_with()


def test_stream_authorizes_before_opening_subscription(
    mocker: pytest_mock.MockerFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = _route_service()
    mocker.patch.object(service, "authorize_session")
    _installed_spy_30 = installed_mock(service.authorize_session)
    _installed_spy_30.side_effect = NotFoundError("missing")
    subscribe = mocker.patch.object(mod.progress_bus, "subscribe")
    monkeypatch.setattr(mod, "build_service", lambda: service)

    assert mod._stream("s1", _actor()) == ({"code": "not_found"}, 404)
    subscribe.assert_not_called()


def test_dify_builder_required_blocks_when_feature_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    wrapped = mod.dify_builder_required(lambda *_args, **_kwargs: ({"ok": True}, 200))
    features = FeatureModel(dify_builder_enabled=False)
    monkeypatch.setattr(mod.FeatureService, "get_features", lambda _tenant_id: features)

    assert wrapped(object(), "t") == ({"code": "feature_unavailable"}, 403)


def test_decorator_stack_gate_blocks_when_feature_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(wraps_mod, "current_account_with_tenant", lambda: (_account(), "ten-9"))
    monkeypatch.setattr(
        mod.FeatureService,
        "get_features",
        lambda _tenant_id: FeatureModel(dify_builder_enabled=False),
    )

    def view(*_args: object, **_kwargs: object) -> NoReturn:
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
def test_session_routes_require_legacy_edit_permission(method: Callable[..., object]) -> None:
    gate = unwrap(method, stop=lambda wrapper: "edit_permission_required" in wrapper.__code__.co_qualname)
    assert "edit_permission_required" in gate.__code__.co_qualname


def test_action_resolves_confirm_through_the_option_the_client_chose(
    mocker: pytest_mock.MockerFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = _route_service()
    mocker.patch.object(service, "submit_action_command")
    _installed_spy_35 = installed_mock(service.submit_action_command)
    _installed_spy_35.return_value = CommandSubmission("command-1", pending=True)
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

    assert response == {"command_id": "command-1", "pending": True, "session": None}

    _installed_spy_36 = installed_mock(service.submit_action_command)
    action = _installed_spy_36.call_args.args[2]
    assert action.kind == "run_verify"
    # The chosen option and any free text travel on to the handler untouched.
    assert action.payload == {"option_id": "run_validation", "free_text": ""}


def test_action_still_accepts_a_client_posting_the_bare_action_id(
    mocker: pytest_mock.MockerFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = _route_service()
    mocker.patch.object(service, "submit_action_command")
    _installed_spy_37 = installed_mock(service.submit_action_command)
    _installed_spy_37.return_value = CommandSubmission("command-1", pending=True)
    monkeypatch.setattr(mod, "build_service", lambda: service)

    mod._action(
        "s1",
        {"action_id": "run_validation", "payload": {}, "base_version": 1, "base_app_revision": "hash-1"},
        _actor(),
    )

    _installed_spy_38 = installed_mock(service.submit_action_command)
    assert _installed_spy_38.call_args.args[2].kind == "run_verify"


@pytest.mark.parametrize(
    "evidence", [None, {}, {"null": None, "false": False, "zero": 0, "empty": "", "list": [], "map": {}}]
)
def test_conversation_result_preserves_terminal_evidence_through_derived_json(
    mocker: pytest_mock.MockerFixture, monkeypatch: pytest.MonkeyPatch, evidence: dict[str, object] | None
) -> None:
    service = _route_service()
    mocker.patch.object(service, "get_conversation_page")
    _installed_spy_39 = installed_mock(service.get_conversation_page)
    _installed_spy_39.return_value = ConversationPage(
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


def test_conversation_historical_result_keeps_missing_evidence_unavailable(
    mocker: pytest_mock.MockerFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = _route_service()
    mocker.patch.object(service, "get_conversation_page")
    _installed_spy_40 = installed_mock(service.get_conversation_page)
    _installed_spy_40.return_value = ConversationPage(
        data=[ConversationItem(seq=0, kind="test_result", at_version=1, payload={"status": "succeeded"})],
        has_more=False,
        first_seq=0,
        last_seq=0,
    )
    monkeypatch.setattr(mod, "build_service", lambda: service)
    response = mod._conversation("s1", {}, _actor())
    assert isinstance(response, dict)
    payload = response["data"][0]["payload"]
    assert payload["terminal_outputs"] is None
    assert payload["outcome"] is None


# -- explicit native Tool consent routes --------------------------------------

_SESSION_ID = "0192a4b0-0000-7000-8000-000000000001"
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


def _no_dispatch() -> DifyBuilderService:
    raise AssertionError("prepare/confirm/status must not build the dispatch owner")


def _decorator_chain(method: Callable[..., object]) -> list[str]:
    """Owner of each wrapper from the outermost decorator inward."""
    names: list[str] = []

    def record(wrapper: object) -> bool:
        assert isinstance(wrapper, FunctionType)
        names.append(wrapper.__code__.co_qualname.split(".")[0])
        return False

    unwrap(method, stop=record)
    return names


def _apidoc(method: Callable[..., object]) -> dict[str, object]:
    documentation = vars(method)["__apidoc__"]
    assert isinstance(documentation, dict)
    return documentation


def _schema_names(value: object) -> list[str]:
    assert isinstance(value, list)
    names: list[str] = []
    for model in value:
        assert isinstance(model, SchemaModel)
        names.append(model.name)
    return names


def _response_model_names(value: object) -> dict[str, str]:
    assert isinstance(value, dict)
    names: dict[str, str] = {}
    for code, response in value.items():
        assert isinstance(code, str)
        assert isinstance(response, tuple)
        model = response[1]
        assert isinstance(model, SchemaModel)
        names[code] = model.name
    return names


class _HeldLease:
    """Per-session advance lease: the first acquire wins until its own token is released."""

    def __init__(self) -> None:
        self.tokens: dict[str, str] = {}
        self.acquired = 0
        self.released: list[str] = []

    def acquire(self, session_id: str, *, generation: int | None = None) -> str | None:
        if session_id in self.tokens:
            return None
        self.acquired += 1
        token = f"token-{self.acquired}"
        self.tokens[session_id] = f"g{generation}:{token}" if generation is not None else token
        return self.tokens[session_id]

    def release(self, session_id: str, token: str) -> None:
        self.released.append(token)
        if self.tokens.get(session_id) == token:
            del self.tokens[session_id]

    def current_owner(self, session_id: str) -> str | None:
        return self.tokens.get(session_id)

    def exists(self, session_id: str) -> bool:
        return session_id in self.tokens


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


# -- real Flask/RESTX requests through the console blueprint and its error handlers --

_CONSENTS_URL = f"/console/api/dify-builder/sessions/{_SESSION_ID}/real-call-consents"


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


_STAGED = select(DifySetup.version).where(DifySetup.version == "staged-by-another-owner")


class _RequestSqlWorld(NamedTuple):
    client: FlaskClient
    registry: scoped_session[OrmSession]
    witness: _OpenTransactions
    boundaries: list[tuple[str, bool, int]]
    enqueued: list[tuple[str, Action, Actor, str]]
    # Per request, just before teardown removes the session: (scoped transaction open,
    # staged write visible to it, staged write visible to any other session).
    teardown: list[tuple[bool, bool, bool]]


@pytest.fixture
def request_sql_world(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[_RequestSqlWorld]:
    """The task control routes and their authenticated request SQL boundaries.

    ``db`` of the console wraps, the controller and the wiring is one real ``scoped_session`` over
    SQLite (the unit app does not initialize Flask-SQLAlchemy); request teardown removes it, as the
    extension does. Real incoming application services bind the account identity and RBAC query
    owners; signed Passport/CSRF tokens enter through the actual request loader and wrappers.
    The Redis advance lease records whether the
    request-scoped session is in a transaction and how many connection transactions are open.
    """
    engine = create_engine(f"sqlite:///{tmp_path / 'request-sql.sqlite3'}")
    Base.metadata.create_all(engine)
    TypeBase.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    registry = scoped_session(factory)
    database = _RouteDatabase(session=registry, engine=engine)
    monkeypatch.setattr(session_factory_module, "_session_maker", factory)
    monkeypatch.setattr(wraps_mod, "db", database)
    monkeypatch.setattr(wiring, "db", database)
    monkeypatch.setattr(mod, "db", database, raising=False)
    apply_config_overrides(
        monkeypatch,
        RBAC_ENABLED=False,
        LOGIN_DISABLED=False,
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
        SECRET_KEY="unit-builder-request-sql-passport-key",
    )
    with factory.begin() as session:
        account = Account(name="tester", email="tester@example.com")
        session.add(account)
        session.flush()
        session.add(DifySetup(version="unit"))
        tenant = Tenant(name="Request SQL workspace")
        tenant.id = "ten-1"
        session.add(tenant)
        session.add(
            App(
                id="app-1",
                tenant_id="ten-1",
                mode=AppMode.WORKFLOW,
                name="Builder app",
                tracing=None,
                enable_site=False,
                enable_api=False,
            )
        )
        session.add(
            TenantAccountJoin(tenant_id="ten-1", account_id=account.id, role=TenantAccountRole.EDITOR, current=True)
        )
    witness = _OpenTransactions(engine)
    boundaries: list[tuple[str, bool, int]] = []

    def observe(name: str) -> None:
        boundaries.append((name, registry().in_transaction(), witness.count))

    def features(_tenant_id: str) -> FeatureModel:
        # The feature gate's billing/enterprise read: the first external boundary after the auth wrappers.
        observe("feature")
        return FeatureModel(dify_builder_enabled=True)

    monkeypatch.setattr(mod.FeatureService, "get_features", features)

    class _ObservedLease(_HeldLease):
        @override
        def acquire(self, session_id: str, *, generation: int | None = None) -> str | None:
            observe("lease_acquire")
            return super().acquire(session_id, generation=generation)

        @override
        def release(self, session_id: str, token: str) -> None:
            observe("lease_release")
            super().release(session_id, token)

    repo = SqlDifyBuilderRepository(session_factory_module.get_session_maker())
    stored_session = DomainSession(
        id=_SESSION_ID,
        app_id="app-1",
        tenant_id="ten-1",
        owner_account_id=account.id,
        entry_mode=EntryMode.BUILD,
        current_state=PcState.BUILD_REVIEW,
        version=3,
    )
    repo.create_session(stored_session, DifyBuilderContext(), [])
    for version in (1, 2):
        repo.compare_and_advance(stored_session.id, version, PcState.BUILD_REVIEW, DifyBuilderContext(), [])
    enqueued: list[tuple[str, Action, Actor, str]] = []

    def enqueue(session_id: str, action: Action, actor: Actor, token: str) -> None:
        observe("enqueue")
        enqueued.append((session_id, action, actor, token))

    service = DifyBuilderService(
        repo,
        _ObservedLease(),
        enqueue,
        authorize_app_fn=wiring._authorize_app,
    )
    monkeypatch.setattr(mod, "build_service", lambda: service)
    app = Flask("dify-builder-request-sql")
    app.config["TESTING"] = True
    app.register_blueprint(console_bp)
    # Use the incoming production composition: repositories own their short Sessions, and the
    # actual login request loader resolves the app-bound account identity before the guard.
    init_application_services(app)
    login_manager.init_app(app)
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
    client = app.test_client()
    access = PassportService().issue({"user_id": account.id, "exp": int(datetime.now(UTC).timestamp()) + 600})
    csrf = generate_csrf_token(account.id)
    client.set_cookie(_real_cookie_name(COOKIE_NAME_CSRF_TOKEN), csrf)
    client.environ_base["HTTP_AUTHORIZATION"] = f"Bearer {access}"
    client.environ_base[f"HTTP_{HEADER_NAME_CSRF_TOKEN.upper().replace('-', '_')}"] = csrf
    try:
        yield _RequestSqlWorld(client, registry, witness, boundaries, enqueued, teardown)
    finally:
        setup_check.reset_success()
        witness.close()
        registry.remove()
        engine.dispose()


@pytest.fixture
def enabled_rbac(
    request: pytest.FixtureRequest, request_sql_world: _RequestSqlWorld, monkeypatch: pytest.MonkeyPatch
) -> dict[RBACPermission, bool]:
    """Keep the real locator/evaluator; replace only the external access RPC with a witness."""
    world = request_sql_world
    enabled = request.param if hasattr(request, "param") else True
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


@pytest.mark.parametrize("operation", ["stop", "resume"])
def test_task_control_routes_delegate_fixed_operation_and_return_session_json(
    operation: str, monkeypatch: pytest.MonkeyPatch, mocker: pytest_mock.MockerFixture
) -> None:
    service = _route_service()
    stop = mocker.patch.object(service, "stop_task")
    resume = mocker.patch.object(service, "resume_task")
    command = stop if operation == "stop" else resume
    command.return_value = _session_view(run_status=RunStatus.PAUSED)
    monkeypatch.setattr(mod, "build_service", lambda: service)
    resource = mod.DifyBuilderTaskStopApi if operation == "stop" else mod.DifyBuilderTaskResumeApi
    app = Flask(__name__)
    with app.test_request_context(json={"base_version": 7, "client_action_id": " control-1 "}):
        response = unwrap(resource.post)(object(), "ten-1", _account(), "s1")
    assert response == DifyBuilderSessionViewResponse.model_validate(
        wiring.session_view_to_dict(command.return_value)
    ).model_dump(mode="json")
    command.assert_called_once_with("s1", _actor(), base_version=7, client_action_id="control-1", base_app_revision="")
    (resume if operation == "stop" else stop).assert_not_called()
    assert _decorator_chain(resource.post) == [
        "setup_required",
        "login_required",
        "account_initialization_required",
        "edit_permission_required",
        "with_current_user",
        "with_current_tenant_id",
        "without_request_read_transaction",
        "dify_builder_required",
    ]
    docs = _apidoc(resource.post)
    assert _schema_names(docs["expect"]) == ["DifyBuilderTaskControlPayload"]
    assert _response_model_names(docs["responses"])["200"] == "DifyBuilderSessionViewResponse"
    assert "x-typed-event-stream" not in docs


@pytest.mark.parametrize("operation", ["stop", "resume"])
@pytest.mark.parametrize(
    "body",
    [
        None,
        {},
        {"base_version": 1},
        {"base_version": "1", "client_action_id": "c"},
        {"base_version": True, "client_action_id": "c"},
        {"base_version": 1.0, "client_action_id": "c"},
        {"base_version": 1, "client_action_id": " "},
        {"base_version": 1, "client_action_id": "x" * 129},
        {"base_version": 1, "client_action_id": "c", "kind": "resume"},
        {"base_version": 1, "client_action_id": "c", "base_app_revision": None},
    ],
)
def test_task_control_invalid_payload_never_calls_service(
    operation: str, body: object, mocker: pytest_mock.MockerFixture
) -> None:
    factory = mocker.patch.object(mod, "build_service", side_effect=AssertionError("service must not be built"))
    resource = mod.DifyBuilderTaskStopApi if operation == "stop" else mod.DifyBuilderTaskResumeApi
    with Flask(__name__).test_request_context(json=body), pytest.raises(mod.BadRequest):
        unwrap(resource.post)(object(), "ten-1", _account(), "s1")
    factory.assert_not_called()


@pytest.mark.parametrize("operation", ["stop", "resume"])
@pytest.mark.parametrize(
    ("error", "status"),
    [
        (NotFoundError("private owner"), 404),
        (ConflictError("private version"), 409),
        (BusyError("lease"), 409),
        (Forbidden(), 403),
    ],
)
def test_task_control_domain_errors_raise_standard_http_errors(
    operation: str, error: Exception, status: int, monkeypatch: pytest.MonkeyPatch, mocker: pytest_mock.MockerFixture
) -> None:
    service = _route_service()
    stop = mocker.patch.object(service, "stop_task")
    resume = mocker.patch.object(service, "resume_task")
    (stop if operation == "stop" else resume).side_effect = error
    monkeypatch.setattr(mod, "build_service", lambda: service)
    resource = mod.DifyBuilderTaskStopApi if operation == "stop" else mod.DifyBuilderTaskResumeApi
    with Flask(__name__).test_request_context(json={"base_version": 1, "client_action_id": "c"}):
        with pytest.raises(HTTPException) as raised:
            unwrap(resource.post)(object(), "ten-1", _account(), "s1")
    assert raised.value.code == status
    assert "private" not in str(raised.value)


@pytest.mark.parametrize("operation", ["stop", "resume"])
def test_task_control_served_json_preserves_trusted_actor_and_no_request_sql(
    operation: str,
    request_sql_world: _RequestSqlWorld,
    monkeypatch: pytest.MonkeyPatch,
    mocker: pytest_mock.MockerFixture,
) -> None:
    world = request_sql_world
    service = _route_service()
    stop = mocker.patch.object(service, "stop_task")
    resume = mocker.patch.object(service, "resume_task")
    command = stop if operation == "stop" else resume

    def control(session_id: str, actor: Actor, **kwargs: object) -> SessionView:
        assert not world.registry().in_transaction()
        assert world.witness.count == 0
        assert actor.tenant_id == "ten-1"
        assert actor.account_id
        assert session_id == "s1"
        assert kwargs == {"base_version": 3, "client_action_id": "control-1", "base_app_revision": "revision-1"}
        return _session_view(run_status=RunStatus.PAUSED)

    command.side_effect = control
    monkeypatch.setattr(mod, "build_service", lambda: service)
    response = world.client.post(
        f"/console/api/dify-builder/sessions/s1/{operation}",
        json={
            "base_version": 3,
            "client_action_id": "control-1",
            "base_app_revision": "revision-1",
        },
    )
    assert response.status_code == 200
    assert response.mimetype == "application/json"
    DifyBuilderSessionViewResponse.model_validate(response.get_json())
    command.assert_called_once()
    assert all(not tx and count == 0 for _, tx, count in world.boundaries)


@pytest.mark.parametrize("operation", ["stop", "resume"])
@pytest.mark.parametrize("failure", ["owner", "permission", "invalid"])
def test_task_control_served_errors_follow_console_contract(
    operation: str,
    failure: str,
    request_sql_world: _RequestSqlWorld,
    monkeypatch: pytest.MonkeyPatch,
    mocker: pytest_mock.MockerFixture,
) -> None:
    service = _route_service()
    stop = mocker.patch.object(service, "stop_task")
    resume = mocker.patch.object(service, "resume_task")
    command = stop if operation == "stop" else resume
    command.side_effect = NotFoundError("private owner") if failure == "owner" else Forbidden()
    monkeypatch.setattr(mod, "build_service", lambda: service)
    body = {"base_version": 3, "client_action_id": "c"}
    response = request_sql_world.client.post(
        f"/console/api/dify-builder/sessions/s1/{operation}", json=body if failure != "invalid" else {}
    )
    assert response.status_code == {"owner": 404, "permission": 403, "invalid": 400}[failure]
    assert set(response.get_json()) == {"code", "message", "status"}
    assert "private" not in response.get_data(as_text=True)
    if failure == "invalid":
        command.assert_not_called()


@pytest.mark.parametrize("operation", ["stop", "resume"])
def test_task_control_requires_authentication_before_service(
    operation: str,
    request_sql_world: _RequestSqlWorld,
    mocker: pytest_mock.MockerFixture,
) -> None:
    factory = mocker.patch.object(mod, "build_service", side_effect=AssertionError("service must not be built"))
    request_sql_world.client.environ_base.pop("HTTP_AUTHORIZATION")
    response = request_sql_world.client.post(
        f"/console/api/dify-builder/sessions/s1/{operation}", json={"base_version": 3, "client_action_id": "c"}
    )
    assert response.status_code == 401
    factory.assert_not_called()
