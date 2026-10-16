"""Actual reader/Thread/Graphon/C03 bridge composition with labeled SQL ports.

Session reads, checkpoint storage, lifecycle and capacity SQL acknowledgements
are fixtures. These units prove no SQL durability, privacy activation or resume.
"""

from __future__ import annotations

import importlib
import importlib.util
from inspect import GEN_SUSPENDED, getgeneratorstate
from threading import Event, Thread, current_thread
from time import monotonic
from types import SimpleNamespace
from typing import cast

import pytest
from models.enums import CreatorUserRole
from models.workflow import WorkflowRun
from services.dify_builder.native_testing.contracts import ApprovalWait, CheckpointRef, PolicyStop, WaitingReceipt
from services.dify_builder.native_testing.generation_wiring import HostOwnedNativeGeneratorStream
from services.dify_builder.native_testing.host_capacity import NativeHostCapacity
from services.dify_builder.native_testing.lifecycle import NativeTestLifecycleService
from services.dify_builder.native_testing.runtime_contracts import NativeCheckpointPayload
from tests.unit_tests.services.dify_builder.native_testing.test_host_execution import LaunchCase, native_entry

from graphon.enums import WorkflowExecutionStatus


def stream_class():
    name = "services.dify_builder.native_testing.stream_runtime"
    assert importlib.util.find_spec(name) is not None, "actual stream coordinator is missing"
    return importlib.import_module(name).DifyNativeStreamOwner


class StreamCase:
    def __init__(self, monkeypatch, *, waiting=False, failed=False, partial=False, stopped=False, baseline=(1, 1, 1)):
        self.case = case = LaunchCase(baseline=baseline)
        from tests.unit_tests.services.dify_builder.native_testing.test_native_observation_wiring import (
            bind_component_observation,
        )

        bind_component_observation(case, monkeypatch)
        policy: dict[str, object] | None = (
            {
                "error_strategy": "default-value",
                "default_value": [{"key": "output", "type": "string", "value": "fallback"}],
            }
            if partial
            else None
        )
        self.entry, self.factory = native_entry(case, monkeypatch, policy=policy)
        factory = self.factory
        self.events = []
        self.done, self.reading, self.source_release = Event(), Event(), Event()
        self.source_release.set()
        self.source_closed = []
        self.checkpoint_error = self.cleanup_error = self.read_error = self.source_error = None
        self.saved: NativeCheckpointPayload | None = None
        if waiting:
            decision = ApprovalWait(pending_operation_id="pending", wait_reason="approval")
            binding = case.prepared()
            case.authorization.decisions[0] = decision
            assert case.cursor.before_call(intent=binding.intent) == decision
            factory.effects.decision = decision
        if failed:
            factory.effects.foreign = RuntimeError("private-business-canary")
        if stopped:
            factory.effects.decision = PolicyStop(reason_code="effect_denied")
        context = case.state.context
        self.row: WorkflowRun | None = WorkflowRun(
            id=context.native_run_id,
            tenant_id=context.tenant_id,
            app_id=context.app_id,
            workflow_id=context.workflow_id,
            created_by=context.actor_id,
            created_by_role=CreatorUserRole.ACCOUNT,
            status="paused"
            if waiting
            else "stopped"
            if stopped
            else "partial-succeeded"
            if partial
            else "failed"
            if failed
            else "succeeded",
        )

        def read(statement):
            self.events.append("read-run")
            # The real SQL statement must constrain every native Run owner.
            params = set(statement.compile().params.values())
            assert {
                context.native_run_id,
                context.tenant_id,
                context.app_id,
                context.workflow_id,
                context.actor_id,
                CreatorUserRole.ACCOUNT,
            } <= params
            if self.read_error:
                raise self.read_error
            return self.row

        class SessionPort:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                pass

            scalar = staticmethod(read)

        self.sessions = SessionPort
        lifecycle = SimpleNamespace(
            _capacity=None,
            loader=SimpleNamespace(session_factory=self.sessions),
            pause=self.pause,
            _mark_unknown=lambda **kwargs: self.events.append("quarantine"),
        )
        self.capacity = NativeHostCapacity(cast(NativeTestLifecycleService, lifecycle), cleanup_verifier=case.lifetime)
        monkeypatch.setattr(self.capacity, "record_cleanup", self.cleanup)
        self.checkpoints = case.host._checkpoints
        assert self.checkpoints is not None
        self.checkpoints._lifecycle = lifecycle
        monkeypatch.setattr(case.state, "commit_checkpoint", self.commit)
        case.host.bind_release(release=lambda: self.events.append("release"))

    def commit(self, *, ref, generation, payload):
        assert ref == self.case.lifetime.ref
        assert generation == self.case.lifetime.generation
        assert self.case.lifetime.context is self.case.state.context
        self.events.append("checkpoint")
        if self.checkpoint_error:
            raise self.checkpoint_error
        self.saved = payload
        return CheckpointRef(checkpoint_id="checkpoint", payload_digest="c" * 64)

    def pause(self, *, ref, checkpoint, pending_operation_ids, expected_generation):
        self.events.append("pause")
        return WaitingReceipt(
            request_id=ref.request_id,
            invocation_id=ref.invocation_id,
            generation=expected_generation,
            checkpoint=checkpoint,
            pending_operation_ids=pending_operation_ids,
            wait_reason="approval",
        )

    def cleanup(self, *, ref, generation, dispatch_id):
        self.events.append("cleanup")
        if self.cleanup_error:
            raise self.cleanup_error
        self.case.lifetime.consume_cleanup(ref=ref, generation=generation, dispatch_id=dispatch_id)

    def worker(self):
        try:
            list(self.entry.run())
        finally:
            self.case.host.worker_finished(worker=current_thread(), exit_kind="returned")
            self.done.set()

    def source(self):
        try:
            import logging

            from libs.sensitive_http_telemetry import _sensitive_http
            from services.dify_builder.native_testing.context_runtime import current_native_observation

            assert _sensitive_http.get()
            assert current_native_observation() is self.case.host.native_observation
            logging.getLogger("core.app.apps.workflow.generate_task_pipeline").error("reader-private-canary")
            self.reading.set()
            assert self.done.wait(2)
            assert self.source_release.wait(2)
            if self.source_error:
                raise self.source_error
            yield "data: private-raw-SSE-canary\n\n"
        finally:
            self.source_closed.append(current_thread())

    def owner(self):
        return stream_class()(
            host=self.case.host,
            capacity=self.capacity,
            session_factory=self.sessions,
            state=self.case.state,
            authorization=self.case.authorization,
            journal=self.case.journal,
            checkpoints=self.checkpoints,
        )

    def start(self):
        worker = Thread(target=self.worker)
        self.case.host.start_worker(worker=worker)
        return worker

    def consume(self, stream=None):
        self.callbacks = []
        return self.owner().consume(
            context=self.case.state.context,
            stream=stream or HostOwnedNativeGeneratorStream(source=self.source(), host=self.case.host),
            on_event=self.callbacks.append,
        )


@pytest.mark.parametrize("failed", [False, True])
def test_actual_root_business_terminal_survives_raw_sse_without_payload_callback(monkeypatch, failed):
    fixture = StreamCase(monkeypatch, failed=failed)
    worker = fixture.start()
    outcome = fixture.consume()
    worker.join(1)
    assert outcome.status == "completed"
    assert outcome.native_status == ("failed" if failed else "succeeded")
    assert fixture.events == ["read-run", "cleanup", "release"]
    assert len(fixture.source_closed) == 1
    assert fixture.source_closed[0] is not current_thread()
    assert all("canary" not in str(event) for event in fixture.callbacks)


def test_close_before_consume_commits_actual_snapshot_then_cleanup_and_public_wait(monkeypatch):
    fixture = StreamCase(monkeypatch, waiting=True)
    worker = fixture.start()
    assert fixture.done.wait(2)  # Typed control closed admission before reader exists.
    outcome = fixture.consume()
    worker.join(1)
    assert outcome.status == "waiting"
    assert outcome.wait_reason == "approval"
    assert outcome.checkpoint_ref.checkpoint_id == "checkpoint"
    assert fixture.events == ["read-run", "checkpoint", "pause", "cleanup", "release"]
    payload = fixture.saved
    assert payload is not None
    assert payload.native_run_id == "run"
    assert payload.generation == 0
    assert payload.node_journals[0].intents[0].kind == "http"
    assert payload.input_result_refs == ("inputs",)
    assert payload.child_refs == ()
    assert '"native_test_required":true' in payload.generate_entity_json
    assert fixture.callbacks[-1]["status"] == "waiting"


@pytest.mark.parametrize("failure", ["checkpoint_error", "cleanup_error", "read_error", "source_error"])
def test_real_owner_failure_never_publishes_wait_and_quarantines(monkeypatch, failure):
    fixture = StreamCase(monkeypatch, waiting=True)
    setattr(fixture, failure, RuntimeError("private-failure-canary"))
    fixture.start()
    outcome = fixture.consume()
    assert outcome.status == "unknown"
    assert "quarantine" in fixture.events
    assert fixture.callbacks == []
    assert "release" not in fixture.events


def test_blocked_reader_returns_unknown_at_first_deadline_and_retains_for_late_cleanup(monkeypatch):
    fixture = StreamCase(monkeypatch, waiting=True, baseline=(0.04, 0.04, 0.04))
    fixture.source_release.clear()
    worker = fixture.start()
    started = monotonic()
    outcome = fixture.consume()
    assert monotonic() - started < 1
    assert outcome.status == "unknown"
    assert fixture.reading.is_set()
    assert fixture.source_closed == []
    assert fixture.events == ["quarantine"]
    assert fixture.case.lifetime.context is fixture.case.state.context
    fixture.source_release.set()
    worker.join(2)
    fixture.case.lifetime.settle()
    fixture.cleanup(ref=fixture.case.lifetime.ref, generation=0, dispatch_id="dispatch")
    fixture.case.host.retire()
    assert fixture.case.lifetime.unknown


def test_root_pause_with_late_native_error_is_unknown_before_checkpoint(monkeypatch):
    fixture = StreamCase(monkeypatch, waiting=True)
    worker = fixture.start()
    assert fixture.done.wait(2)
    fixture.entry.graph_engine.graph_runtime_state.graph_execution.fail(RuntimeError("private-late-canary"))
    outcome = fixture.consume()
    worker.join(1)
    assert outcome.status == "unknown"
    assert "checkpoint" not in fixture.events
    assert fixture.callbacks == []


def test_persisted_run_status_disagreement_or_missing_run_cannot_complete(monkeypatch):
    fixture = StreamCase(monkeypatch)
    fixture.row = None
    fixture.start()
    assert fixture.consume().status == "unknown"
    assert fixture.events == ["read-run", "quarantine"]


def test_external_close_is_not_natural_drain_or_wait(monkeypatch):
    fixture = StreamCase(monkeypatch, waiting=True)
    fixture.start()
    assert fixture.done.wait(2)
    stream = HostOwnedNativeGeneratorStream(source=fixture.source(), host=fixture.case.host)
    stream.close()
    assert fixture.consume(stream).status == "unknown"
    assert fixture.callbacks == []


def test_foreign_stream_and_repeated_consume_refuse_without_new_reader(monkeypatch):
    fixture = StreamCase(monkeypatch)
    other = LaunchCase()
    stream = HostOwnedNativeGeneratorStream(source=fixture.source(), host=other.host)
    with pytest.raises(ValueError):
        fixture.consume(stream)
    owner = fixture.owner()
    fixture.start()
    actual = HostOwnedNativeGeneratorStream(source=fixture.source(), host=fixture.case.host)
    assert (
        owner.consume(context=fixture.case.state.context, stream=actual, on_event=lambda event: None).status
        == "completed"
    )
    reader = owner._reader
    with pytest.raises(ValueError):
        owner.consume(context=fixture.case.state.context, stream=actual, on_event=lambda event: None)
    assert owner._reader is reader


def test_actual_persistence_status_disagreement_is_unknown_before_checkpoint(monkeypatch):
    fixture = StreamCase(monkeypatch, waiting=True)
    assert fixture.row is not None
    fixture.row.status = WorkflowExecutionStatus.SUCCEEDED
    fixture.start()
    assert fixture.consume().status == "unknown"
    assert "checkpoint" not in fixture.events


def test_failed_capacity_ack_after_physical_consumption_does_not_publish_wait(monkeypatch):
    fixture = StreamCase(monkeypatch, waiting=True)

    def lost_ack(**kwargs):
        fixture.cleanup(**kwargs)
        raise RuntimeError("private-lost-capacity-ack")

    monkeypatch.setattr(fixture.capacity, "record_cleanup", lost_ack)
    fixture.start()
    outcome = fixture.consume()
    assert outcome.status == "unknown"
    assert fixture.callbacks == []
    assert "release" not in fixture.events


def test_existing_workflow_owner_finally_close_after_retirement_is_inert(monkeypatch):
    fixture = StreamCase(monkeypatch)
    fixture.start()
    stream = HostOwnedNativeGeneratorStream(source=fixture.source(), host=fixture.case.host)
    assert fixture.consume(stream).status == "completed"
    stream.close()  # DifyNativeWorkflowOwner.run's existing finally.
    stream.close()
    assert fixture.events.count("release") == 1


def test_automatic_next_close_failure_then_reader_finalizer_never_allows_cleanup(monkeypatch):
    fixture = StreamCase(monkeypatch)
    attempts = []

    def source():
        assert fixture.done.wait(2)
        try:
            # The real converter serializes while this real source is suspended.
            yield {"unserializable": object()}
        except GeneratorExit:
            attempts.append(current_thread())
            yield "still-suspended-after-failed-close"

    actual_source = source()
    stream = HostOwnedNativeGeneratorStream(source=actual_source, host=fixture.case.host)
    owner = fixture.owner()
    worker = fixture.start()
    try:
        outcome = owner.consume(context=fixture.case.state.context, stream=stream, on_event=lambda event: None)
        worker.join(1)
        assert owner._reader is not None
        owner._reader.join(1)
        assert not owner._reader.is_alive()
        assert outcome.status == "unknown"
        assert attempts == [owner._reader]
        assert getgeneratorstate(actual_source) == GEN_SUSPENDED
        assert fixture.events == ["quarantine"]
        with pytest.raises(ValueError, match="^native_host_cleanup_incomplete$"):
            fixture.case.lifetime.consume_cleanup(
                ref=fixture.case.lifetime.ref,
                generation=0,
                dispatch_id="dispatch",
            )
        with pytest.raises(ValueError):
            fixture.case.host.retire()
        assert attempts == [owner._reader]
    finally:
        # Fixture teardown terminates the malformed generator after assertions;
        # it is not a source-close retry or a production cleanup acknowledgement.
        with pytest.raises(RuntimeError, match="fixture-teardown"):
            actual_source.throw(RuntimeError("fixture-teardown"))


def test_real_native_partial_business_outcome_and_typed_stop_preserve_routes(monkeypatch):
    partial = StreamCase(monkeypatch, failed=True, partial=True)
    partial.start()
    outcome = partial.consume()
    assert outcome.status == "completed"
    assert outcome.native_status == "partial-succeeded"
    stopped = StreamCase(monkeypatch, stopped=True)
    stopped.start()
    outcome = stopped.consume()
    assert outcome.status == "stopped"
    assert outcome.reason_code == "effect_denied"


def test_slow_native_work_before_first_control_has_no_host_run_timeout(monkeypatch):
    fixture = StreamCase(monkeypatch, baseline=(0.01, 0.01, 0.01))
    entered, release = Event(), Event()
    original = fixture.factory.effects.render

    def slow(*args):
        entered.set()
        assert release.wait(2)
        return original(*args)

    monkeypatch.setattr(fixture.factory.effects, "render", slow)
    fixture.start()
    results = []
    coordinator = Thread(target=lambda: results.append(fixture.consume()))
    coordinator.start()
    try:
        assert entered.wait(1)
        assert not fixture.done.wait(0.12)
        assert fixture.case.host.settlement_deadline is None
        assert results == []
    finally:
        release.set()
        coordinator.join(2)
    assert results[0].status == "completed"


def test_blocked_admission_fence_does_not_block_coordinator_quarantine(monkeypatch):
    fixture = StreamCase(monkeypatch, waiting=True, baseline=(0.04, 0.04, 0.04))
    fixture.case.ports.entered, fixture.case.ports.release = Event(), Event()
    worker = fixture.start()
    try:
        assert fixture.case.ports.entered.wait(1)
        started = monotonic()
        assert fixture.consume().status == "unknown"
        assert monotonic() - started < 1
        assert fixture.events == ["quarantine"]
        assert worker.is_alive()
    finally:
        fixture.case.ports.release.set()
        worker.join(2)
    fixture.case.lifetime.settle()
    fixture.cleanup(ref=fixture.case.lifetime.ref, generation=0, dispatch_id="dispatch")
    fixture.case.host.retire()


def test_dispatcher_logging_release_failure_precedes_capacity_ack(monkeypatch):
    from libs.sensitive_http_telemetry import SensitiveThreadLogLease

    fixture = StreamCase(monkeypatch)
    actual_release = SensitiveThreadLogLease.release_after_exit

    def failed_release(self):
        raise ValueError("synthetic lease cleanup failure")

    monkeypatch.setattr(SensitiveThreadLogLease, "release_after_exit", failed_release)
    worker = fixture.start()
    outcome = fixture.consume()
    worker.join(2)
    assert outcome.status == "unknown"
    assert fixture.events == ["read-run", "quarantine"]
    assert fixture.callbacks == []
    assert fixture.case.host._dispatcher_log_leases
    for lease in fixture.case.host._dispatcher_log_leases:
        assert not lease.thread.is_alive()
        actual_release(lease)  # Test-only teardown; no capacity cleanup ACK.
