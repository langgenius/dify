"""Native observation must outlive commands without periodically reading SQL."""

import json
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import override

import pytest
import pytest_mock
from sqlalchemy.orm import Session, sessionmaker

from core.dify_builder.models import Actor
from libs.broadcast_channel.exc import SubscriptionClosedError
from models.dify_builder_native_tests import NativeTestScope
from runtime_contracts.builder.native.contracts import NativeTestContextRef
from services.dify_builder import wiring
from services.dify_builder.native_testing.public_contracts import NativeTestPublicReceipt
from services.dify_builder.native_testing.repository import OwnedNativeTestLoader
from tests.unit_tests.services.dify_builder.test_stream_frames import _FakeSubscription, _internal_finished, _view


class _LiveSubscription(_FakeSubscription):
    @override
    def receive(self, timeout: float | None = None) -> bytes | None:
        if not self._items:
            raise SubscriptionClosedError
        return super().receive(timeout)


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


def _decode(frame: str) -> dict:
    return json.loads(next(line[6:] for line in frame.splitlines() if line.startswith("data: ")))


def test_native_idle_stream_waits_for_bus_change_and_hydrates_terminal_projection(mocker: pytest_mock.MockerFixture):
    reads = mocker.Mock(side_effect=[(_receipt(),), (_receipt("terminal", 2),)])
    view = _view(run_status="waiting_input", version=3, conversation_last_seq=8, last_command_id="c")
    projection = mocker.Mock(return_value=view)
    subscription = _LiveSubscription([None, json.dumps({"kind": "native_state_changed", "session_id": "s1"}).encode()])
    frames = list(
        wiring.stream_advance_frames(
            _view(run_status="waiting_input"),
            subscription,
            False,
            emit_command_started=False,
            emit_command_finished_when_settled=True,
            native_receipts=reads,
            read_session_view=projection,
        )
    )
    events = [_decode(frame) for frame in frames if not frame.startswith(":")]
    assert [event["data"]["receipt"]["status"] for event in events if event["event"] == "native_execution"] == [
        "running",
        "terminal",
    ]
    assert reads.call_count == 2  # initial restoration and actual bus change, never idle heartbeats
    assert events[-1]["event"] == "command_finished"
    assert events[-1]["data"]["conversation_last_seq"] == 8
    assert subscription.closed


def test_native_stream_continues_after_command_finished(mocker: pytest_mock.MockerFixture):
    reads = mocker.Mock(side_effect=[(_receipt(),), (_receipt("terminal", 2),)])
    subscription = _LiveSubscription(
        [
            json.dumps(_internal_finished()).encode(),
            json.dumps({"kind": "native_state_changed", "session_id": "s1"}).encode(),
        ]
    )
    frames = list(
        wiring.stream_advance_frames(
            _view(),
            subscription,
            True,
            emit_command_started=False,
            native_receipts=reads,
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


def test_legacy_stream_ignores_native_change_notifications():
    subscription = _FakeSubscription(
        [
            json.dumps({"kind": "native_state_changed", "session_id": "s1"}).encode(),
            json.dumps(_internal_finished()).encode(),
        ]
    )
    events = [_decode(frame) for frame in wiring.stream_advance_frames(_view(), subscription, True)]
    assert [event["event"] for event in events] == ["command_started", "command_finished"]


@pytest.mark.parametrize("rollback", [False, True])
def test_native_change_notification_follows_commit_and_never_rollback(
    sqlite_session_factory: sessionmaker[Session], mocker: pytest_mock.MockerFixture, rollback: bool
) -> None:
    loader = OwnedNativeTestLoader(
        sqlite_session_factory, actor=Actor(account_id="a", tenant_id="t"), resolver=mocker.Mock()
    )
    mocker.patch.object(loader, "_load", return_value=(SimpleNamespace(session_id="s1"), None))
    observed = []

    def published(session_id: str) -> None:
        # Another transaction can already see the durable change when notified.
        with sqlite_session_factory() as sql:
            assert sql.get(NativeTestScope, "r") is not None
        observed.append(session_id)

    mocker.patch("services.dify_builder.progress_bus.publish_native_change", side_effect=published)
    ref = NativeTestContextRef(request_id="r", invocation_id="i", context_digest="a" * 64)
    try:
        with loader.locked(ref=ref) as (sql, _, _):
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
            sql.flush()  # Explicit flush must not cause premature delivery or lose notification.
            assert observed == []
            if rollback:
                raise ValueError("synthetic rollback")
    except ValueError:
        assert rollback
    assert observed == ([] if rollback else ["s1"])
    with loader.locked(ref=ref):
        pass
    assert observed == ([] if rollback else ["s1"])  # Observation alone cannot feed a notification loop.


def test_notification_failure_does_not_fail_or_replay_committed_execution(mocker: pytest_mock.MockerFixture) -> None:
    from services.dify_builder import progress_bus

    publish = mocker.patch.object(progress_bus, "publish", side_effect=RuntimeError("offline"))
    progress_bus.publish_native_change("s1")
    publish.assert_called_once_with("s1", {"kind": "native_state_changed", "session_id": "s1"})


def test_native_stream_does_not_miss_creation_after_initial_snapshot_or_delayed_result(
    mocker: pytest_mock.MockerFixture,
) -> None:
    reads = mocker.Mock(side_effect=[(), (_receipt("terminal", 2),), (_receipt("terminal", 2),)])
    projection = mocker.Mock(
        side_effect=[
            _view(run_status="waiting_input", version=2, conversation_last_seq=1),
            _view(run_status="waiting_input", version=3, conversation_last_seq=8),
        ]
    )
    notification = json.dumps({"kind": "native_state_changed", "session_id": "s1"}).encode()
    subscription = _LiveSubscription([json.dumps(_internal_finished()).encode(), notification, notification])
    frames = list(
        wiring.stream_advance_frames(
            _view(),
            subscription,
            True,
            emit_command_started=False,
            native_receipts=reads,
            read_session_view=projection,
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
    assert subscription.closed


def test_native_snapshots_never_call_execution_recovery(mocker: pytest_mock.MockerFixture) -> None:
    from services.dify_builder.native_testing.confirmed_agent_commands import ConfirmedAgentCommands

    api = mocker.MagicMock()
    api.get.return_value = _receipt()
    api.loader.session_factory.return_value.__enter__.return_value.scalars.return_value.all.return_value = ["r"]
    commands = ConfirmedAgentCommands(api=api, continuation=mocker.Mock(), backend=mocker.Mock(), publish=mocker.Mock())
    mocker.patch.object(commands, "_request")
    recovery = mocker.patch.object(commands, "get", side_effect=AssertionError("observation dispatched recovery"))
    outbox = mocker.patch.object(commands, "publish_pending", side_effect=AssertionError("observation dispatched work"))
    actor = Actor(account_id="a", tenant_id="t")
    assert commands.snapshots(actor=actor, session_id="s1") == (_receipt(),)
    recovery.assert_not_called()
    outbox.assert_not_called()


def test_read_only_snapshot_keeps_physically_clean_paused_parent_unresolved(mocker: pytest_mock.MockerFixture) -> None:
    from services.dify_builder.native_testing.confirmed_agent_commands import ConfirmedAgentCommands

    api = mocker.MagicMock()
    data = _receipt("terminal", 2).model_dump(mode="json")
    data.update(
        {
            "outcome": "cancelled",
            "native_status": "paused",
            "cancellation": {"request_id": "r", "generation": 0, "status": "cancelled", "operation_states": {}},
        }
    )
    api.get.return_value = NativeTestPublicReceipt.model_validate(data)
    commands = ConfirmedAgentCommands(api=api, continuation=mocker.Mock(), backend=mocker.Mock(), publish=mocker.Mock())
    request = mocker.patch.object(commands, "_request")
    receipt = commands.peek(actor=Actor(account_id="a", tenant_id="t"), session_id="s1", request_id="r")
    assert receipt.status == "running"
    assert receipt.outcome is None
    assert receipt.cancellation is not None
    assert receipt.cancellation.status == "cancelled"
    request.assert_called_once()
