"""Native observation must outlive commands without periodically reading SQL."""

import json
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import NoReturn, TypedDict

import pytest
from redis import Redis
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.dify_builder.models import Actor
from libs.broadcast_channel.exc import SubscriptionClosedError
from libs.broadcast_channel.redis.streams_channel import _StreamsSubscription
from models.dify_builder_native_tests import (
    NativeInvocationState,
    NativePayloadObject,
    NativeTestInvocation,
    NativeTestScope,
)
from models.workflow import WorkflowRun
from services.dify_builder import progress_bus, wiring
from services.dify_builder.native_testing import api_service
from services.dify_builder.native_testing.api_service import NativeTestApiService
from services.dify_builder.native_testing.confirmed_agent_commands import ConfirmedAgentCommands
from services.dify_builder.native_testing.public_contracts import NativeTestPublicReceipt
from services.dify_builder.native_testing.repository import native_observation_transaction
from tests.unit_tests.services.dify_builder.native_testing import test_confirmed_agent_completion
from tests.unit_tests.services.dify_builder.native_testing.test_confirmed_agent_completion import CompletedOwner
from tests.unit_tests.services.dify_builder.test_stream_frames import _internal_finished, _view

completed = test_confirmed_agent_completion.completed
declining = test_confirmed_agent_completion.declining


def _subscription(monkeypatch: pytest.MonkeyPatch, events: Sequence[bytes | None]) -> _StreamsSubscription:
    # Only the receive transport is supplied; the concrete subscription owns
    # initialization and resource closure, without opening a Redis connection.
    subscription = _StreamsSubscription(Redis(host="127.0.0.1", port=1), "native-observation")
    messages = iter(events)

    def receive(timeout: float | None = 0.1) -> bytes | None:
        del timeout
        try:
            return next(messages)
        except StopIteration:
            raise SubscriptionClosedError from None

    monkeypatch.setattr(subscription, "receive", receive)
    return subscription


def _assert_closed(subscription: _StreamsSubscription) -> None:
    # Call the real method after the supplied transport has finished. Closure
    # must be observable before any listener/network activation is attempted.
    with pytest.raises(SubscriptionClosedError):
        _StreamsSubscription.receive(subscription, timeout=0)


def _receipt(status: str = "running", version: int = 1) -> NativeTestPublicReceipt:
    return NativeTestPublicReceipt.model_validate(
        {
            "request_id": "r",
            "generation": 0,
            "version": version,
            "status": status,
            "wait_reason": None,
            "native_run_id": None,
            "native_status": None,
            "pending": [],
            "outcome": "succeeded" if status == "terminal" else None,
            "evidence_refs": [],
        }
    )


class _FrameData(TypedDict):
    receipt: dict[str, str]
    conversation_last_seq: int


class _DecodedFrame(TypedDict):
    event: str
    data: _FrameData


def _decode(frame: str) -> _DecodedFrame:
    return json.loads(next(line[6:] for line in frame.splitlines() if line.startswith("data: ")))


def test_native_idle_stream_waits_for_bus_change_and_hydrates_terminal_projection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    receipts = iter([(_receipt(),), (_receipt("terminal", 2),)])
    read_count = 0

    def read_receipts() -> tuple[NativeTestPublicReceipt, ...]:
        nonlocal read_count
        read_count += 1
        return next(receipts)

    view = _view(run_status="waiting_input", version=3, conversation_last_seq=8, last_command_id="c")
    subscription = _subscription(
        monkeypatch, [None, json.dumps({"kind": "native_state_changed", "session_id": "s1"}).encode()]
    )
    frames = list(
        wiring.stream_advance_frames(
            _view(run_status="waiting_input"),
            subscription,
            False,
            emit_command_started=False,
            emit_command_finished_when_settled=True,
            native_receipts=read_receipts,
            read_session_view=lambda: view,
        )
    )
    events = [_decode(frame) for frame in frames if not frame.startswith(":")]
    assert [event["data"]["receipt"]["status"] for event in events if event["event"] == "native_execution"] == [
        "running",
        "terminal",
    ]
    assert read_count == 2  # Initial restoration and bus change, never idle heartbeats.
    assert events[-1]["event"] == "command_finished"
    assert events[-1]["data"]["conversation_last_seq"] == 8
    _assert_closed(subscription)


def test_native_stream_continues_after_command_finished(monkeypatch: pytest.MonkeyPatch) -> None:
    receipts = iter([(_receipt(),), (_receipt("terminal", 2),)])
    subscription = _subscription(
        monkeypatch,
        [
            json.dumps(_internal_finished()).encode(),
            json.dumps({"kind": "native_state_changed", "session_id": "s1"}).encode(),
        ],
    )
    frames = list(
        wiring.stream_advance_frames(
            _view(),
            subscription,
            True,
            emit_command_started=False,
            native_receipts=lambda: next(receipts),
            read_session_view=lambda: _view(run_status="waiting_input", version=3, conversation_last_seq=9),
        )
    )
    events = [_decode(frame) for frame in frames]
    assert [event["event"] for event in events] == [
        "native_execution",
        "command_finished",
        "native_execution",
        "command_finished",
    ]
    assert events[-1]["data"]["conversation_last_seq"] == 9
    _assert_closed(subscription)


def test_legacy_stream_ignores_native_change_notifications(monkeypatch: pytest.MonkeyPatch) -> None:
    subscription = _subscription(
        monkeypatch,
        [
            json.dumps({"kind": "native_state_changed", "session_id": "s1"}).encode(),
            json.dumps(_internal_finished()).encode(),
        ],
    )
    events = [_decode(frame) for frame in wiring.stream_advance_frames(_view(), subscription, True)]
    assert [event["event"] for event in events] == ["command_started", "command_finished"]
    _assert_closed(subscription)


@pytest.mark.parametrize("rollback", [False, True])
def test_native_change_notification_follows_commit_and_never_rollback(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, rollback: bool
) -> None:
    observed: list[str] = []

    def published(session_id: str) -> None:
        # Another transaction can already see the durable change when notified.
        with sqlite_session_factory() as sql:
            assert sql.get(NativeTestScope, "r") is not None
        observed.append(session_id)

    monkeypatch.setattr(progress_bus, "publish_native_change", published)
    try:
        with native_observation_transaction(sqlite_session_factory, session_id=lambda: "s1") as sql:
            sql.add(
                NativeTestScope(
                    request_id="r",
                    tenant_id="t",
                    generation=0,
                    task_approved=True,
                    cancelled=False,
                    expires_at=datetime.now(UTC),
                    budget_limits={},
                    budget_spent={},
                    profile={},
                    max_calls=1,
                    max_dispatches=1,
                    max_cost_units=1,
                )
            )
            sql.flush()  # Explicit flush must not notify early or lose the notification.
            assert observed == []
            if rollback:
                raise ValueError("synthetic rollback")
    except ValueError:
        assert rollback
    assert observed == ([] if rollback else ["s1"])
    with native_observation_transaction(sqlite_session_factory, session_id=lambda: "s1"):
        pass
    assert observed == ([] if rollback else ["s1"])  # Reads cannot feed a notification loop.


def test_notification_failure_does_not_fail_or_replay_committed_execution(monkeypatch: pytest.MonkeyPatch) -> None:
    attempts: list[tuple[str, dict[str, object]]] = []

    def unavailable(session_id: str, event: dict[str, object]) -> NoReturn:
        attempts.append((session_id, event))
        raise RuntimeError("offline")

    monkeypatch.setattr(progress_bus, "publish", unavailable)
    progress_bus.publish_native_change("s1")
    assert attempts == [("s1", {"kind": "native_state_changed", "session_id": "s1"})]


def test_native_stream_does_not_miss_creation_after_initial_snapshot_or_delayed_result(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    receipts = iter([(), (_receipt("terminal", 2),), (_receipt("terminal", 2),)])
    projections = iter(
        [
            _view(run_status="waiting_input", version=2, conversation_last_seq=1),
            _view(run_status="waiting_input", version=3, conversation_last_seq=8),
        ]
    )
    notification = json.dumps({"kind": "native_state_changed", "session_id": "s1"}).encode()
    subscription = _subscription(monkeypatch, [json.dumps(_internal_finished()).encode(), notification, notification])
    frames = list(
        wiring.stream_advance_frames(
            _view(),
            subscription,
            True,
            emit_command_started=False,
            native_receipts=lambda: next(receipts),
            read_session_view=lambda: next(projections),
        )
    )
    events = [_decode(frame) for frame in frames]
    assert [event["event"] for event in events] == [
        "command_finished",
        "native_execution",
        "command_finished",
        "command_finished",
    ]
    assert events[-1]["data"]["conversation_last_seq"] == 8
    _assert_closed(subscription)


def _restore_public_reads(owner: CompletedOwner, monkeypatch: pytest.MonkeyPatch) -> None:
    api = owner.commands.api
    monkeypatch.setattr(api, "get", NativeTestApiService.get.__get__(api))
    monkeypatch.setattr(owner.commands, "_request", ConfirmedAgentCommands._request.__get__(owner.commands))

    def permission(actor: Actor, app_id: str, source: object) -> None:
        assert actor == owner.case.actor
        assert app_id == owner.case.workflow.app_id
        assert source is owner.factory

    # Current scoped SQL ownership remains real; only the RBAC/RPC boundary is supplied.
    monkeypatch.setattr(api_service, "check_execution_permission", permission)


def test_native_snapshots_never_call_execution_recovery(
    declining: CompletedOwner, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = declining
    _restore_public_reads(owner, monkeypatch)

    def recovery_forbidden(*_args: object, **_kwargs: object) -> NoReturn:
        pytest.fail("observation attempted execution recovery or queue publication")

    monkeypatch.setattr(owner.commands, "get", recovery_forbidden)
    monkeypatch.setattr(owner.commands, "publish_pending", recovery_forbidden)
    monkeypatch.setattr(owner.commands, "publish", recovery_forbidden)
    receipts = owner.commands.snapshots(actor=owner.case.actor, session_id=owner.session.id)
    assert len(receipts) == 1
    assert receipts[0].status == "waiting"
    assert receipts[0].native_status == "paused"
    assert owner.repo.get_run(owner.verify_id).status == "running"
    assert not any(item.kind == "test_result" for item in owner.repo.list_conversation(owner.session.id))


def test_read_only_snapshot_keeps_physically_clean_paused_parent_unresolved(
    declining: CompletedOwner, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = declining
    _restore_public_reads(owner, monkeypatch)
    with owner.factory.begin() as sql:
        scope = sql.get(NativeTestScope, owner.request_id)
        state = sql.scalar(select(NativeInvocationState).where(NativeInvocationState.request_id == owner.request_id))
        invocation = sql.scalar(select(NativeTestInvocation).where(NativeTestInvocation.request_id == owner.request_id))
        assert scope is not None
        assert state is not None
        assert invocation is not None
        scope.cancelled = True
        state.state, state.cancellation_key, state.cleanup_complete = "cancelled", "cancel-proof", True
        invocation.active = False
        sql.add(
            NativePayloadObject(
                id=state.context_object_id,
                tenant_id=owner.case.actor.tenant_id,
                request_id=owner.request_id,
                invocation_id=state.invocation_id,
                kind="context",
                logical_key="context",
                storage_key="context-storage",
                payload_digest="a" * 64,
                value_digest="b" * 64,
            )
        )
    receipt = owner.commands.peek(actor=owner.case.actor, session_id=owner.session.id, request_id=owner.request_id)
    assert receipt.status == "running"
    assert receipt.outcome is None
    assert receipt.cancellation is not None
    assert receipt.cancellation.status == "cancelled"
    assert owner.repo.get_run(owner.verify_id).status == "running"
    with owner.factory() as sql:
        native = sql.get(WorkflowRun, owner.native_id)
        assert native is not None
        assert native.status == "paused"
