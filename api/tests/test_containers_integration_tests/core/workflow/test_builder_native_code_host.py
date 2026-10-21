"""CI-only pinned gevent-process bridge witnesses. NEVER collect/run locally.

Real patched Graphon workers, retained host handles and PostgreSQL SELECTs;
Code persistence and scope HTTP responses remain explicit offline doubles.
This cannot qualify A7 isolation, destructive cleanup, or live SSRF routing.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from runtime_contracts.builder.native.contracts import (
        EffectIntent,
    )
    from services.dify_builder.native_testing.host_execution import HostBoundCodeCalls


class NativeThreadHandle(Protocol):
    def is_done(self) -> bool: ...


def test_real_gevent_graph_worker_joins_code_loop(db_session_with_containers: Session) -> None:
    _launch(db_session_with_containers, "joined")


def test_late_code_exit_after_node_worker_exit_remains_unknown(
    db_session_with_containers: Session,
) -> None:
    _launch(db_session_with_containers, "late")


def test_real_gevent_cancelled_scope_call_keeps_cleanup_owned(
    db_session_with_containers: Session,
) -> None:
    _launch(db_session_with_containers, "cancelled")


def _launch(session: Session, mode: str) -> None:
    import json
    import os
    import subprocess
    import sys
    from pathlib import Path

    from sqlalchemy import Engine

    from tests.test_containers_integration_tests.core.workflow.builder_native_fixture_records import require_instance

    # Executing this file directly gives Python its fixture directory rather
    # than the API import root. Preserve any caller paths after the API root.
    api_root = str(Path(__file__).resolve().parents[4])
    env = dict(os.environ)
    env["PYTHONPATH"] = os.pathsep.join(filter(None, (api_root, env.get("PYTHONPATH"))))
    url = require_instance(session.get_bind(), Engine).url.render_as_string(hide_password=False)
    result = subprocess.run(
        [sys.executable, str(Path(__file__).resolve()), mode],
        env=env,
        input=json.dumps({"database_url": url}),
        text=True,
        capture_output=True,
        timeout=90,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert f"CODE_HOST_PROCESS_PASS:{mode}" in result.stdout


def _process(mode: str) -> None:
    import asyncio
    import json
    import sys
    import threading
    from time import monotonic
    from typing import override

    import gevent
    import pytest
    from gevent._hub_local import get_hub_if_exists
    from gevent.monkey import get_original
    from sqlalchemy import create_engine, text
    from sqlalchemy.pool import NullPool

    from graphon.engine.layer import Layer
    from graphon.engine.worker.worker import Worker
    from graphon.engine_events.base import EngineEvent
    from graphon.entities.base_node_data import BaseNodeData
    from graphon.nodes.base.node import Node
    from services.code_execution.native_scope_transport import NativeCodeIdentity
    from services.dify_builder.native_testing.control import NativePolicyStop
    from services.dify_builder.native_testing.sandbox import sync_bridge
    from services.dify_builder.native_testing.sandbox.host import (
        NativeCodeHostOperation,
    )
    from services.dify_builder.native_testing.sandbox.scope_client import CodeHttpRequest
    from tests.unit_tests.services.dify_builder.native_testing.test_call_adapter import (
        REF,
    )
    from tests.unit_tests.services.dify_builder.native_testing.test_code_host import (
        code_case,
        composed,
    )
    from tests.unit_tests.services.dify_builder.native_testing.test_host_execution import (
        _run_observed,
        native_entry,
    )

    engine = create_engine(json.loads(sys.stdin.read())["database_url"], poolclass=NullPool)
    native_ident = get_original("_thread", "get_ident")
    native_lock = get_original("_thread", "allocate_lock")
    release = native_lock()
    release.acquire()
    loops: list[asyncio.AbstractEventLoop] = []
    handles: list[NativeThreadHandle] = []
    sql_threads: list[threading.Thread] = []
    node_threads: list[threading.Thread] = []
    hub_checks: list[int] = []
    original_loop = sync_bridge._Loop

    class CheckedLoop(original_loop):
        def __init__(self) -> None:
            assert get_hub_if_exists() is None
            super().__init__()
            assert get_hub_if_exists() is None

        @override
        def close(self) -> None:
            assert get_hub_if_exists() is None
            super().close()
            assert get_hub_if_exists() is None
            hub_checks.append(native_ident())

    try:
        # Two independent actual operations and roots, not a reused loop capsule.
        for _index in range(2 if mode == "joined" else 1):
            with pytest.MonkeyPatch.context() as patch:
                patch.setattr(sync_bridge, "_Loop", CheckedLoop)
                case = code_case()
                calls, intent, dispatch, _owner, _events, _prefix = composed(case, patch)
                entry, _ = native_entry(case, patch)
                errors: list[str] = []
                if mode == "late":
                    original_settle = NativeCodeHostOperation.settle

                    async def delayed_settlement(
                        self: NativeCodeHostOperation,
                        identity: NativeCodeIdentity,
                        *,
                        succeeded: bool,
                        _settle=original_settle,
                    ) -> None:
                        await _settle(self, identity, succeeded=succeeded)
                        # Exact destruction is already observed; actual native
                        # work remains live until coordinator releases this gate.
                        release.acquire(timeout=10)
                        release.release()

                    patch.setattr(NativeCodeHostOperation, "settle", delayed_settlement)
                if mode == "cancelled":
                    original_stall_service = NativeCodeHostOperation._service

                    def stalled_service(
                        self: NativeCodeHostOperation, kind: str, payload: object, _service=original_stall_service
                    ) -> object:
                        if kind == "http":
                            assert isinstance(payload, CodeHttpRequest)
                            if payload.path.endswith("/input"):
                                self.owner.host.request_close(reason="cancel")
                                gevent.sleep(0.03)
                        return _service(self, kind, payload)

                    patch.setattr(NativeCodeHostOperation, "_service", stalled_service)

                original_service = NativeCodeHostOperation._service

                def checked_service(
                    self: NativeCodeHostOperation, kind: str, payload: object, _service=original_service
                ) -> object:
                    worker = threading.current_thread()
                    assert isinstance(worker, Worker)
                    if kind == "check":
                        with engine.connect() as connection:
                            assert connection.execute(text("SELECT 1")).scalar_one() == 1
                        sql_threads.append(worker)
                    return _service(self, kind, payload)

                patch.setattr(NativeCodeHostOperation, "_service", checked_service)

                class CodeWitness(Layer):
                    @override
                    def on_graph_start(self) -> None:
                        pass

                    @override
                    def on_graph_end(self, error: Exception | None) -> None:
                        pass

                    @override
                    def on_event(self, event: EngineEvent) -> None:
                        pass

                    @override
                    def on_node_run_start(
                        self,
                        node: Node[BaseNodeData],
                        _calls: HostBoundCodeCalls = calls,
                        _intent: EffectIntent = intent,
                        _dispatch=dispatch,
                        _errors=errors,
                    ) -> None:
                        if node.id != "start":
                            return
                        node_threads.append(threading.current_thread())
                        try:
                            assert _calls.call(ref=REF, intent=_intent, dispatch=_dispatch) == "ok"
                        except NativePolicyStop:
                            if mode == "joined":
                                _errors.append("unexpected unknown")
                        except BaseException as error:
                            _errors.append(type(error).__name__)

                entry.graph_engine.add_layer(CodeWitness())
                worker = threading.Thread(target=lambda _case=case, _entry=entry: _run_observed(_case, _entry))
                case.host.start_worker(worker=worker)
                worker.join(15)
                assert not worker.is_alive()
                assert not errors
                (participant,) = case.lifetime.code_participants
                if mode == "late":
                    assert not participant.bridge.joined
                    assert case.lifetime.unknown
                    assert all(not item.is_alive() for item in node_threads)
                    release.release()
                    deadline = monotonic() + 5
                    while not participant.bridge.joined and monotonic() < deadline:
                        participant.refresh_join()
                        gevent.sleep(0.001)
                assert participant.bridge.joined
                assert participant.bridge.loop_closed
                assert participant.bridge._handle.ident != native_ident()
                assert all(client.closed for client in participant._client.clients)
                assert participant.bridge._loop is not None
                assert participant.bridge._loop.is_closed()
                loops.append(participant.bridge._loop)
                handles.append(participant.bridge._handle)
                case.host.request_close(reason="exhausted")
                settlement = case.lifetime.settle()
                if mode in ("late", "cancelled"):
                    assert settlement == "unknown"
                    assert case.authorization.outcomes[0][0] == "unknown"
                else:
                    assert settlement == "settled"
                if participant.cleanup_complete:
                    case.lifetime.consume_cleanup(ref=REF, generation=0, dispatch_id=case.lifetime.dispatch_id)
                else:
                    with pytest.raises(ValueError, match="^native_host_cleanup_incomplete$"):
                        case.lifetime.consume_cleanup(ref=REF, generation=0, dispatch_id=case.lifetime.dispatch_id)
        assert sql_threads
        assert all(isinstance(worker, Worker) for worker in sql_threads)
        assert all(worker in node_threads for worker in sql_threads)
        assert len({id(loop) for loop in loops}) == len(loops)
        assert all(handle.is_done() for handle in handles)
        assert len(hub_checks) == len(handles)
        assert all(ident != native_ident() for ident in hub_checks)
        sys.stdout.write(f"CODE_HOST_PROCESS_PASS:{mode}\n")
    finally:
        if release.locked():
            release.release()
        engine.dispose()


if __name__ == "__main__":
    # Same source-confirmed production app.py order, before other imports.
    from gevent import monkey

    monkey.patch_all()
    import psycogreen.gevent as psycogreen_gevent
    from grpc.experimental import gevent as grpc_gevent

    grpc_gevent.init_gevent()
    psycogreen_gevent.patch_psycopg()
    import sys

    _process(sys.argv[1])
