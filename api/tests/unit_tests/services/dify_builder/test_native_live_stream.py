"""Native observation must outlive commands without periodically reading SQL."""

import json
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta, timezone
from typing import NoReturn, TypedDict

import pytest
from redis import Redis
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.dify_builder.models import Actor
from graphon.enums import WorkflowExecutionStatus
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
    test_execution: dict[str, object]


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


@pytest.mark.parametrize("expired", [False, True])
@pytest.mark.parametrize("clock_offset", [None, 0, -8, 8])
def test_native_snapshot_scope_expiry_preserves_utc_microsecond_boundary(
    declining: CompletedOwner, monkeypatch: pytest.MonkeyPatch, expired: bool, clock_offset: int | None
) -> None:
    owner = declining
    _restore_public_reads(owner, monkeypatch)
    deadline = datetime(2030, 1, 1, 12, 0, 0, 123456, tzinfo=UTC)
    now = deadline if expired else deadline - timedelta(microseconds=1)
    now = now.replace(tzinfo=None) if clock_offset is None else now.astimezone(timezone(timedelta(hours=clock_offset)))
    with owner.factory.begin() as sql:
        scope = sql.get(NativeTestScope, owner.request_id)
        assert scope is not None
        scope.expires_at = deadline
    with owner.factory() as sql:
        scope = sql.get(NativeTestScope, owner.request_id)
        assert scope is not None
        assert scope.expires_at.tzinfo is None
    monkeypatch.setattr(api_service, "utc_now", lambda: now)
    (receipt,) = owner.commands.snapshots(actor=owner.case.actor, session_id=owner.session.id)
    assert receipt.status == "waiting"
    assert (receipt.resume_blocked_reason == "native_expired") is expired
    if expired:
        assert not receipt.can_resume
    assert owner.repo.get_run(owner.verify_id).status == "running"


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


@pytest.mark.parametrize("declining", [2], indirect=True)
def test_resumed_cancelled_parent_session_history_and_sse_stay_readonly(
    declining: CompletedOwner, monkeypatch: pytest.MonkeyPatch
) -> None:
    from flask import Flask, Response
    from sqlalchemy import Table, event

    from controllers.console import dify_builder as controller
    from models.dify_builder_native_tests import NativeDispatch, NativeEffectGrant, NativePendingAction
    from services.dify_builder.native_testing.confirmed_agent_commands import ProfiledNativeTestCommands
    from services.dify_builder.native_testing.lifecycle import NativeTestLifecycleService
    from services.dify_builder.service import DifyBuilderService
    from services.dify_builder.test_actions import BuilderTestActions
    from tests.unit_tests.services.dify_builder.test_service import FakeSessionLock

    owner = declining
    with owner.factory.begin() as sql:
        for model in (NativeEffectGrant, NativePendingAction):
            table = model.__table__
            assert isinstance(table, Table)
            table.create(sql.connection(), checkfirst=True)
        sql.add(
            NativePayloadObject(
                id="context",
                tenant_id=owner.case.actor.tenant_id,
                request_id=owner.request_id,
                invocation_id=owner.ref.invocation_id,
                kind="context",
                logical_key="context",
                storage_key="context-storage",
                payload_digest="a" * 64,
                value_digest="b" * 64,
            )
        )
        sql.add(
            NativeDispatch(
                id="source-two",
                tenant_id=owner.case.actor.tenant_id,
                request_id=owner.request_id,
                invocation_id=owner.ref.invocation_id,
                generation=2,
                state="completed",
                checkpoint_id="checkpoint",
                idempotency_digest="e" * 64,
            )
        )
        from models.dify_builder_native_tests import NativeEffectOperation

        operation = sql.scalar(select(NativeEffectOperation))
        assert operation is not None
        operation.state = "completed"
    _restore_public_reads(owner, monkeypatch)
    lifecycle = owner.commands.api.lifecycle
    monkeypatch.setattr(lifecycle, "cancel", NativeTestLifecycleService.cancel.__get__(lifecycle))
    # The caller does not use the mutation response; subsequent reads must need
    # neither a second cancellation nor a completion/recovery side effect.
    owner.commands.cancel(
        actor=owner.case.actor,
        session_id=owner.session.id,
        request_id=owner.request_id,
        idempotency_key="lost-cancel-ack",
    )
    owner.commands.backend.client.get_run_sync = lambda _: pytest.fail("read queried child runtime")
    commands = ProfiledNativeTestCommands(
        sessions=owner.factory,
        actor=owner.case.actor,
        confirmed_factory=lambda: owner.commands,
        legacy_factory=lambda: pytest.fail("changed runtime profile"),
    )
    service = DifyBuilderService(
        owner.repo,
        FakeSessionLock(),
        lambda *_: pytest.fail("read enqueued work"),
        get_app_revision_fn=lambda *_: "fixture-revision",
        test_actions=BuilderTestActions(owner.factory, lambda **_: commands),
    )
    monkeypatch.setattr(controller, "build_service", lambda: service)
    monkeypatch.setattr(controller, "build_native_test_api_service", lambda **_: commands)
    monkeypatch.setattr(controller.progress_bus, "subscribe", lambda _: _subscription(monkeypatch, []))
    statements: list[str] = []

    def observe(_c: object, _u: object, statement: str, _p: object, _x: object, _m: object) -> None:
        statements.append(statement)

    engine = owner.factory.kw["bind"]
    event.listen(engine, "before_cursor_execute", observe)
    try:
        with Flask(__name__).test_request_context():
            view = controller._get_session(owner.session.id, owner.case.actor)
            assert isinstance(view, dict)
            receipt = view["test_execution"]
            assert receipt["request_id"] == owner.request_id
            assert receipt["native_run_id"] == owner.native_id
            assert receipt["status"] == "terminal"
            assert receipt["outcome"] == "cancelled"
            assert receipt["cancellation"]["status"] == "cancelled"
            assert not receipt["can_resume"]
            history = controller._conversation(owner.session.id, {}, owner.case.actor)
            assert isinstance(history, dict)
            response = controller._stream(owner.session.id, owner.case.actor, native_version="builder-native-test-v1")
            assert isinstance(response, Response)
            frames = response.get_data(as_text=True)
            assert '"outcome":"cancelled"' in frames.replace(" ", "")
    finally:
        event.remove(engine, "before_cursor_execute", observe)
    assert not any(q.lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE")) for q in statements)
    assert owner.cancel_calls == ["original-child"]
    with owner.factory() as sql:
        state = sql.scalar(select(NativeInvocationState))
        assert state is not None
        assert not state.cleanup_complete
    assert owner.repo.get_run(owner.verify_id).status == "failed"


@pytest.mark.parametrize("completed", ["confirmed"], indirect=True)
@pytest.mark.parametrize("legacy", [False, True])
def test_current_model_failure_diagnostic_is_stable_owned_and_readonly(
    completed: CompletedOwner, legacy: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    from sqlalchemy import event

    from models.dify_builder import DifyBuilderExecutionRequest
    from services.dify_builder.test_actions import BuilderTestActions

    owner = completed
    failure = "NativeAgentModelDispatchFailed: Native Agent model invocation failed."
    if not legacy:
        failure += " [stage=invoke; reason=quota_exceeded]"
    at = datetime(2026, 10, 24, 12, tzinfo=UTC)
    with owner.factory.begin() as sql:
        run = sql.get(WorkflowRun, owner.native_id)
        assert run is not None
        run.status, run.error, run.finished_at = WorkflowExecutionStatus.FAILED, failure, at
        request = sql.get(DifyBuilderExecutionRequest, owner.request_id)
        assert request is not None
        request.state, request.completion_summary = "running", None
        state = sql.scalar(select(NativeInvocationState))
        assert state is not None
        state.state, state.outcome = "unknown", {"status": "unknown"}
        scope = sql.get(NativeTestScope, owner.request_id)
        assert scope is not None
        scope.expires_at = datetime(2020, 1, 1, tzinfo=UTC)  # History remains readable after grant expiry.
        state.app_id, state.workflow_id = owner.case.workflow.app_id, owner.case.workflow.id
        sql.add(
            NativeTestInvocation(
                tenant_id=owner.case.actor.tenant_id,
                request_id=owner.request_id,
                invocation_id="root",
                active=True,
                bindings={},
            )
        )
    reader = BuilderTestActions(owner.factory, lambda **_: pytest.fail("diagnostic executed command"))
    receipt = NativeTestPublicReceipt(
        request_id=owner.request_id,
        generation=1,
        version=1,
        status="running",
        wait_reason=None,
        native_run_id=owner.native_id,
        native_status="failed",
        pending=(),
        outcome="unknown",
        evidence_refs=(),
    )
    statements: list[str] = []

    def observe(_c: object, _u: object, statement: str, _p: object, _x: object, _m: object) -> None:
        statements.append(statement)

    engine = owner.factory.kw["bind"]
    event.listen(engine, "before_cursor_execute", observe)
    try:
        first = reader.current_diagnostics(
            actor=owner.case.actor, session_id=owner.session.id, test_input_id=owner.saved_id, receipt=receipt
        )
        assert len(first) == 1
        assert (
            reader.current_diagnostics(
                actor=owner.case.actor, session_id=owner.session.id, test_input_id=owner.saved_id, receipt=receipt
            )
            == first
        )
        assert first[0]["at"] == at.isoformat()
        assert first[0]["code"] == "native_model_invocation_failed"
        if legacy:
            assert "native_stage" not in first[0]
            assert "native_category" not in first[0]
        else:
            assert first[0]["native_stage"] == "invoke"
            assert first[0]["native_category"] == "quota_exceeded"
        assert (
            reader.current_diagnostics(
                actor=Actor(account_id="foreign", tenant_id=owner.case.actor.tenant_id),
                session_id=owner.session.id,
                test_input_id=owner.saved_id,
                receipt=receipt,
            )
            == []
        )
        assert (
            reader.current_diagnostics(
                actor=owner.case.actor, session_id=owner.session.id, test_input_id="foreign", receipt=receipt
            )
            == []
        )
        assert (
            reader.current_diagnostics(
                actor=owner.case.actor, session_id="foreign", test_input_id=owner.saved_id, receipt=receipt
            )
            == []
        )
        assert (
            reader.current_diagnostics(
                actor=Actor(account_id=owner.case.actor.account_id, tenant_id="foreign"),
                session_id=owner.session.id,
                test_input_id=owner.saved_id,
                receipt=receipt,
            )
            == []
        )
        assert (
            reader.current_diagnostics(
                actor=owner.case.actor,
                session_id=owner.session.id,
                test_input_id=owner.saved_id,
                receipt=receipt.model_copy(update={"request_id": "foreign"}),
            )
            == []
        )
        from dataclasses import asdict

        from controllers.console.dify_builder_fields import DifyBuilderSessionViewResponse
        from libs.helper import dump_response
        from services.dify_builder.native_testing.confirmed_agent_commands import ProfiledNativeTestCommands
        from services.dify_builder.service import DifyBuilderService
        from tests.unit_tests.services.dify_builder.test_service import FakeSessionLock

        _restore_public_reads(owner, monkeypatch)
        assert owner.commands.backend is None  # No SDK/backend can be invoked by this read.
        commands = ProfiledNativeTestCommands(
            sessions=owner.factory,
            actor=owner.case.actor,
            confirmed_factory=lambda: owner.commands,
            legacy_factory=lambda: pytest.fail("changed profile"),
        )
        service = DifyBuilderService(
            owner.repo,
            FakeSessionLock(),
            lambda *_: pytest.fail("read enqueued work"),
            get_app_revision_fn=lambda *_: "fixture-revision",
            test_actions=BuilderTestActions(owner.factory, lambda **_: commands),
        )
        view = service.get_session_view(owner.session.id, owner.case.actor)
        assert view.diagnostics == first
        assert service.get_session_view(owner.session.id, owner.case.actor).diagnostics == first
        exported = dump_response(
            DifyBuilderSessionViewResponse, wiring._public_session_view(asdict(view), include_last_command_id=True)
        )
        assert exported["diagnostics"] == first
        subscription = _subscription(
            monkeypatch, [json.dumps({"kind": "native_state_changed", "session_id": owner.session.id}).encode()]
        )
        frames = list(
            wiring.stream_advance_frames(
                asdict(view),
                subscription,
                False,
                emit_command_finished_when_settled=True,
                emit_command_started=False,
                native_receipts=lambda: (receipt,),
                read_session_view=lambda: asdict(service.get_session_view(owner.session.id, owner.case.actor)),
            )
        )
        envelopes = [json.loads(frame.split("data: ", 1)[1]) for frame in frames]
        snapshots = [envelope["data"] for envelope in envelopes if envelope["event"] == "command_finished"]
        assert len(snapshots) == 2
        assert all(snapshot["diagnostics"] == first for snapshot in snapshots)
        _assert_closed(subscription)
        monkeypatch.setattr(
            service._test_actions, "current_diagnostics", lambda **_: (_ for _ in ()).throw(RuntimeError())
        )
        without_diagnostic = service.get_session_view(owner.session.id, owner.case.actor)
        assert asdict(without_diagnostic) == {**asdict(view), "diagnostics": []}
        assert (
            reader.current_diagnostics(
                actor=owner.case.actor,
                session_id=owner.session.id,
                test_input_id=owner.saved_id,
                receipt=receipt.model_copy(update={"native_run_id": "foreign"}),
            )
            == []
        )
    finally:
        event.remove(engine, "before_cursor_execute", observe)
    assert not any(q.lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE")) for q in statements)
    with owner.factory() as sql:
        request = sql.get(DifyBuilderExecutionRequest, owner.request_id)
        state = sql.scalar(select(NativeInvocationState))
        assert request is not None
        assert request.state == "running"
        assert request.completion_summary is None
        assert state is not None
        assert state.state == "unknown"
        assert state.outcome == {"status": "unknown"}
        scope = sql.get(NativeTestScope, owner.request_id)
        assert scope is not None
        assert scope.expires_at == datetime(2020, 1, 1)


@pytest.mark.parametrize("completed", ["confirmed"], indirect=True)
@pytest.mark.parametrize(
    "drift",
    [
        "tenant",
        "app",
        "workflow",
        "creator",
        "role",
        "session",
        "input",
        "context",
        "current",
        "error",
        "unfinished",
        "draft",
    ],
)
def test_native_model_diagnostic_owner_drift(completed: CompletedOwner, drift: str) -> None:
    from uuid import uuid4

    from sqlalchemy import update

    from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderSession, DifyBuilderTestInput
    from services.dify_builder.test_actions import BuilderTestActions

    owner = completed
    with owner.factory.begin() as sql:
        parent = sql.get(WorkflowRun, owner.native_id)
        request = sql.get(DifyBuilderExecutionRequest, owner.request_id)
        assert parent is not None
        assert request is not None
        parent.status = WorkflowExecutionStatus.FAILED
        parent.error = (
            "NativeAgentModelDispatchFailed: Native Agent model invocation failed. [stage=invoke; reason=timeout]"
        )
        parent.finished_at = datetime(2026, 10, 24, tzinfo=UTC)
        if drift in {"tenant", "app", "workflow", "creator", "role"}:
            column = {
                "tenant": "tenant_id",
                "app": "app_id",
                "workflow": "workflow_id",
                "creator": "created_by",
                "role": "created_by_role",
            }[drift]
            sql.execute(
                update(WorkflowRun)
                .where(WorkflowRun.id == owner.native_id)
                .values({column: "end_user" if drift == "role" else str(uuid4())})
            )
        elif drift == "session":
            sql.execute(
                update(DifyBuilderSession)
                .where(DifyBuilderSession.id == owner.session.id)
                .values(owner_account_id=str(uuid4()))
            )
        elif drift == "input":
            sql.execute(
                update(DifyBuilderTestInput)
                .where(DifyBuilderTestInput.id == owner.saved_id)
                .values(session_id=str(uuid4()))
            )
        elif drift == "context":
            request.context_digest = "f" * 64
        elif drift == "current":
            sql.add(
                DifyBuilderExecutionRequest(
                    id=str(uuid4()),
                    tenant_id=request.tenant_id,
                    app_id=request.app_id,
                    workflow_id=request.workflow_id,
                    actor_id=request.actor_id,
                    session_id=request.session_id,
                    test_input_id=request.test_input_id,
                    context=request.context,
                    context_digest=request.context_digest,
                    created_at=request.created_at + timedelta(days=1),
                )
            )
        elif drift == "error":
            parent.error = "NativeAgentModelDispatchFailed: Native Agent model invocation failed. secret-provider-body"
        elif drift == "unfinished":
            parent.finished_at = None
        elif drift == "draft":
            from models.workflow import Workflow

            workflow = sql.get(Workflow, request.workflow_id)
            assert workflow is not None
            workflow.graph = json.dumps({"nodes": [], "edges": []})
    reader = BuilderTestActions(owner.factory, lambda **_: pytest.fail("diagnostic executed work"))
    receipt = NativeTestPublicReceipt(
        request_id=owner.request_id,
        generation=1,
        version=1,
        status="running",
        wait_reason=None,
        native_run_id=owner.native_id,
        native_status="failed",
        pending=(),
        outcome="unknown",
        evidence_refs=(),
    )
    observed = reader.current_diagnostics(
        actor=owner.case.actor, session_id=owner.session.id, test_input_id=owner.saved_id, receipt=receipt
    )
    if drift == "draft":
        assert len(observed) == 1
        assert observed[0]["native_category"] == "timeout"
    else:
        assert observed == []


@pytest.mark.parametrize(
    "boundary",
    ["startup", "ack_context", "launched", "cancelled", "expired", "owner", "generation", "inactive", "other_policy"],
)
def test_startup_stream_defers_only_until_sql_root_initialization(
    completed: CompletedOwner, monkeypatch: pytest.MonkeyPatch, boundary: str
) -> None:

    from sqlalchemy import Table
    from sqlalchemy.orm import make_transient

    from models.dify_builder import DifyBuilderExecutionRequest
    from services.dify_builder.service import DifyBuilderService
    from services.dify_builder.test_actions import BuilderTestActions
    from tests.unit_tests.services.dify_builder.test_service import FakeSessionLock

    owner = completed
    _restore_public_reads(owner, monkeypatch)
    with owner.factory.begin() as sql:
        for model in (NativePayloadObject, NativeTestInvocation):
            table = model.__table__
            assert isinstance(table, Table)
            table.create(sql.connection(), checkfirst=True)
        root = sql.scalar(select(NativeInvocationState))
        request = sql.get(DifyBuilderExecutionRequest, owner.request_id)
        scope = sql.get(NativeTestScope, owner.request_id)
        assert root is not None
        assert request is not None
        assert scope is not None
        sql.expunge(root)
        make_transient(root)
        state_table = NativeInvocationState.__table__
        assert isinstance(state_table, Table)
        sql.execute(state_table.delete())
        request.state, request.native_run_id = "running", None
        request.observations = [
            {
                "native_command_key": "start-key",
                "body_digest": "a" * 64,
                "receipt": _receipt("prepared")
                .model_copy(update={"request_id": owner.request_id})
                .model_dump(mode="json"),
            }
        ]
        scope.generation = 0
        sql.add(
            NativeTestInvocation(
                tenant_id=owner.case.actor.tenant_id,
                request_id=owner.request_id,
                invocation_id="root",
                active=True,
                bindings={},
            )
        )
    with owner.factory.begin() as sql:
        request = sql.get(DifyBuilderExecutionRequest, owner.request_id)
        scope = sql.get(NativeTestScope, owner.request_id)
        invocation = sql.scalar(select(NativeTestInvocation))
        assert request is not None
        assert scope is not None
        assert invocation is not None
        if boundary == "ack_context":
            sql.add(
                NativePayloadObject(
                    id="context",
                    tenant_id=owner.case.actor.tenant_id,
                    request_id=owner.request_id,
                    invocation_id="root",
                    kind="context",
                    logical_key="context",
                    storage_key="context-storage",
                    payload_digest="a" * 64,
                    value_digest="b" * 64,
                )
            )
        elif boundary == "launched":
            request.observations = [{**request.observations[0], "admission_launched": True}]
        elif boundary == "cancelled":
            scope.cancelled = True
        elif boundary == "expired":
            scope.expires_at = datetime(2000, 1, 1, tzinfo=UTC)
        elif boundary == "owner":
            request.actor_id = "foreign"
        elif boundary == "generation":
            scope.generation = 1
        elif boundary == "inactive":
            invocation.active = False
        elif boundary == "other_policy":
            request.context_digest = "f" * 64
    from services.dify_builder.native_testing.confirmed_agent_commands import ProfiledNativeTestCommands

    commands = ProfiledNativeTestCommands(
        sessions=owner.factory,
        actor=owner.case.actor,
        confirmed_factory=lambda: owner.commands,
        legacy_factory=lambda: pytest.fail("unexpected legacy profile"),
    )
    reader = BuilderTestActions(owner.factory, lambda **_: commands)
    service = DifyBuilderService(
        owner.repo,
        FakeSessionLock(),
        lambda *_: pytest.fail("observer dispatched"),
        get_app_revision_fn=lambda *_: "fixture-revision",
        test_actions=reader,
    )
    if boundary != "startup":
        assert not reader.observation_initializing(
            actor=owner.case.actor, session_id=owner.session.id, test_input_id=owner.saved_id
        )
        from runtime_contracts.builder.execution import BuilderExecutionPolicyError

        with pytest.raises(BuilderExecutionPolicyError):
            owner.commands.api.get(actor=owner.case.actor, session_id=owner.session.id, request_id=owner.request_id)
        if boundary != "owner":
            subscription = _subscription(
                monkeypatch, [json.dumps({"kind": "native_state_changed", "session_id": owner.session.id}).encode()]
            )
            frames = list(
                wiring.stream_advance_frames(
                    {**_view(), "session_id": owner.session.id},
                    subscription,
                    True,
                    read_session_view=lambda: service._read_stream_session_view(owner.session.id, owner.case.actor),
                )
            )
            assert [_decode(frame)["event"] for frame in frames] == ["command_started", "error"]
            _assert_closed(subscription)
        return
    # Ordinary authenticated reads stay strict even during this startup window.
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError

    with pytest.raises(BuilderExecutionPolicyError, match="native_state_unavailable"):
        service.get_session_view(owner.session.id, owner.case.actor)
    reads = 0

    def read_view() -> dict[str, object] | None:
        nonlocal reads
        reads += 1
        result = service._read_stream_session_view(owner.session.id, owner.case.actor)
        if reads == 1:
            assert result is None
            with owner.factory.begin() as sql:
                sql.add(root)
                request = sql.get(DifyBuilderExecutionRequest, owner.request_id)
                scope = sql.get(NativeTestScope, owner.request_id)
                assert request is not None
                assert scope is not None
                request.state, request.native_run_id = "sealed", owner.native_id
                scope.generation = 1
        return result

    notification = json.dumps({"kind": "native_state_changed", "session_id": owner.session.id}).encode()
    subscription = _subscription(monkeypatch, [notification, notification])
    frames = list(
        wiring.stream_advance_frames(
            {**_view(), "session_id": owner.session.id},
            subscription,
            True,
            read_session_view=read_view,
            command_id="original-command",
        )
    )
    assert frames[1] == ": keep-alive\n\n"
    events = [_decode(frame) for frame in frames if not frame.startswith(":")]
    assert [event["event"] for event in events] == ["command_started", "command_finished"]
    assert events[-1]["data"]["test_execution"]["request_id"] == owner.request_id
    assert reads == 2
    _assert_closed(subscription)
