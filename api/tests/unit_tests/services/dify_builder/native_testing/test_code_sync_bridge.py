"""Native bridge behavior without patched runtime, SQL, or network."""

import asyncio
from contextlib import suppress
from threading import get_ident
from time import monotonic
from typing import override

import pytest


def bridge_module():
    from services.dify_builder.native_testing.sandbox import sync_bridge

    return sync_bridge


def test_owned_loop_runs_on_distinct_native_thread_and_origin_services_mailbox():
    module = bridge_module()
    origin = get_ident()
    seen = []
    bridge = module.NativeCodeLoopBridge(
        deadline=monotonic() + 1,
        close_deadline=monotonic() + 2,
        service=lambda _kind, payload: seen.append(get_ident()) or payload,
    )

    async def operation():
        assert get_ident() != origin
        assert bridge.call("check", "value") == "value"
        assert await bridge.request("check", "async") == "async"
        return "done"

    assert bridge.run(operation) == "done"
    assert seen == [origin, origin]
    assert bridge.joined
    assert bridge.loop_closed
    with pytest.raises(ValueError, match="^native_code_start_refused$"):
        bridge.run(operation)


def test_cancel_is_sticky_and_joins_same_cleanup_task():
    module = bridge_module()
    bridge = module.NativeCodeLoopBridge(
        deadline=monotonic() + 0.03,
        close_deadline=monotonic() + 0.5,
        service=lambda _kind, _payload: None,
    )
    finished = []

    async def operation():
        try:
            await asyncio.sleep(5)
        finally:
            await asyncio.sleep(0.01)
            finished.append("closed")
        return "done"

    with pytest.raises(ValueError, match="^native_code_execution_unknown$"):
        bridge.run(operation)
    assert finished == ["closed"]
    assert bridge.joined
    assert bridge.loop_closed
    assert bridge.cancelled


def test_expired_mailbox_never_services_late_admission():
    module = bridge_module()
    seen = []
    bridge = module.NativeCodeLoopBridge(
        deadline=monotonic() - 1,
        close_deadline=monotonic() + 0.1,
        service=lambda kind, _payload: seen.append(kind),
    )

    async def operation():
        bridge.call("check", None)
        return "bad"

    with pytest.raises(ValueError, match="^native_code_start_refused$"):
        bridge.run(operation)
    assert not seen


def test_late_native_exit_is_retained_after_bounded_handoff():
    from threading import Event
    from time import sleep

    module = bridge_module()
    release = Event()
    bridge = module.NativeCodeLoopBridge(
        deadline=monotonic() + 0.02,
        close_deadline=monotonic() + 0.04,
        service=lambda _kind, _payload: None,
    )

    async def operation():
        release.wait(1)  # Deliberately noncooperative native work.
        return "late"

    try:
        with pytest.raises(ValueError, match="^native_code_work_retained$"):
            bridge.run(operation)
        assert bridge.cancelled
        assert not bridge.joined
        release.set()
        limit = monotonic() + 1
        while not bridge.joined and monotonic() < limit:
            bridge.refresh_join()
            sleep(0.001)
        assert bridge.joined
        assert bridge.loop_closed
        assert bridge.cancelled
    finally:
        release.set()


def test_settlement_mailbox_survives_cancelled_inflight_admission():
    from time import sleep

    module = bridge_module()
    seen = []

    def service(kind, payload):
        del payload
        seen.append(kind)
        if kind == "http":
            sleep(0.04)

    bridge = module.NativeCodeLoopBridge(deadline=monotonic() + 0.02, close_deadline=monotonic() + 0.5, service=service)

    async def operation():
        try:
            await bridge.request("http", None)
        finally:
            # Match the reviewed adapter's retained cancellation-safe teardown.
            cleanup = asyncio.create_task(bridge.request("destroy", None, settlement=True))
            while not cleanup.done():
                with suppress(asyncio.CancelledError):
                    await asyncio.shield(cleanup)
            cleanup.result()
        return "done"

    with pytest.raises(ValueError, match="^native_code_execution_unknown$"):
        bridge.run(operation)
    assert seen == ["http", "destroy"]
    assert bridge.joined
    assert bridge.loop_closed


def test_phase_deadlines_shorten_without_stealing_execution_or_extending_cleanup(
    monkeypatch,
):
    module = bridge_module()
    clock = [100.0]
    monkeypatch.setattr(module, "monotonic", lambda: clock[0])
    bridge = module.NativeCodeLoopBridge(
        deadline=115,
        close_deadline=125,
        service=lambda *_a: None,
        create_deadline=105,
        execution_seconds=10,
        join_deadline=126,
        join_seconds=1,
        settlement_seconds=5,
    )
    assert bridge._enqueue("create", None, False).deadline == 105
    bridge._message = None
    clock[0] = 102
    bridge.created()
    assert bridge.deadline == 112
    clock[0] = 108
    bridge.begin_settlement()
    assert bridge.close_deadline == 113
    bridge.begin_settlement()
    assert bridge.close_deadline == 113
    bridge.begin_join()
    assert bridge.join_deadline == 109
    bridge.cancel(deadline=200)
    assert bridge.join_deadline == 109
    assert bridge.close_deadline == 113


def test_late_scope_ack_refuses_execution_and_root_close_reserves_actual_join(
    monkeypatch,
):
    module = bridge_module()
    clock = [106.0]
    monkeypatch.setattr(module, "monotonic", lambda: clock[0])
    bridge = module.NativeCodeLoopBridge(
        deadline=115,
        close_deadline=125,
        service=lambda *_a: None,
        create_deadline=105,
        execution_seconds=10,
        join_deadline=126,
        join_seconds=1,
        settlement_seconds=5,
    )
    with pytest.raises(ValueError, match="create_expired"):
        bridge.created()
    bridge.cancel(deadline=110)
    assert bridge.close_deadline == 109
    assert bridge.join_deadline == 110
    bridge.cancel(deadline=120)
    assert bridge.close_deadline == 109
    assert bridge.join_deadline == 110


def test_loop_close_stall_retains_actual_handle_after_distinct_join_allowance(
    monkeypatch,
):
    from threading import Event
    from time import sleep

    module = bridge_module()
    release = Event()
    original = module._Loop

    class ClosingLoop(original):
        @override
        def close(self):
            release.wait(1)
            super().close()

    monkeypatch.setattr(module, "_Loop", ClosingLoop)
    now = monotonic()
    bridge = module.NativeCodeLoopBridge(
        deadline=now + 0.2,
        close_deadline=now + 0.3,
        service=lambda *_a: None,
        create_deadline=now + 0.1,
        execution_seconds=0.1,
        join_deadline=now + 0.32,
        join_seconds=0.02,
        settlement_seconds=0.1,
    )

    async def operation():
        return "done"

    try:
        with pytest.raises(ValueError, match="retained"):
            bridge.run(operation)
        assert not bridge.joined
        assert not bridge.loop_closed
        assert bridge.join_deadline < now + 0.2
        release.set()
        limit = monotonic() + 1
        while not bridge.joined and monotonic() < limit:
            bridge.refresh_join()
            sleep(0.001)
        assert bridge.joined
        assert bridge.loop_closed
        assert bridge.cancelled
    finally:
        release.set()
