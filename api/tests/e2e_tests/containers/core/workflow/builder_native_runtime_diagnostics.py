"""Local and CI passive trace for the existing native runtime SQL witnesses.

Import only the fixture into test_builder_native_runtime.py. This module is not
an independently collected suite. No production hooks or logging are added.
Records contain fixed stage names, counts, booleans and SHA-256 identifiers.
No URLs, input/output values, serialized checkpoints, grant tokens or exception
text are emitted. Only the serialized payload returned by the real checkpoint is parsed. Restore
and entry observations read existing owners/counts without queue serialization.
No extra snapshot, dump, restore, graph or factory is constructed.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from functools import wraps
from threading import Lock

import pytest

_TARGET = "tests.test_containers_integration_tests.core.workflow.test_builder_native_runtime"
_LIMIT = 256


def _digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _snapshot(serialized: str) -> dict[str, object]:
    """Inspect scheduling/identity fields only; never retain content material."""
    saved = json.loads(serialized)
    if saved["version"] != "3.0":
        raise ValueError("native_runtime_diagnostics_snapshot_version")
    execution = json.loads(saved["graph_execution"])
    queues = [json.loads(saved[name])["items"] for name in ("ready_queue", "deferred_ready_tasks")]
    return {
        "snapshot_version": saved["version"],
        "started": execution["started"],
        "paused": execution["paused"],
        "completed": execution["completed"],
        "aborted": execution["aborted"],
        "ready_count": len(queues[0]),
        "deferred_count": len(queues[1]),
        "ready_digest": _digest(queues[0]),
        "deferred_digest": _digest(queues[1]),
        "execution_identity_digest": _digest(execution["node_executions"]),
        "node_state_digest": _digest(saved["graph_node_states"]),
        "container_run_count": len(saved["container_runs"]),
        "container_frame_count": len(saved["container_frames"]),
    }


def _runtime_counts(runtime) -> dict[str, object]:
    """Read existing owners only; never serialize, iterate or drain a queue."""
    fields = runtime.__dict__
    execution = runtime.graph_execution
    return {
        "started": execution.started,
        "paused": execution.paused,
        "completed": execution.completed,
        "aborted": execution.aborted,
        "ready_count": runtime.ready_queue.qsize(),
        "deferred_count": fields["_deferred_ready_queue"].qsize(),
        "container_run_count": len(runtime.container_runs()),
        "container_frame_count": len(runtime.container_frames()),
    }


@pytest.fixture(autouse=True)
def native_runtime_resume_diagnostics(request, monkeypatch, record_property):
    """Transparent, module-limited observation; execution/outcomes stay untouched."""
    if request.module.__name__ != _TARGET:
        yield
        return
    # Ordering is explicit: wrap the fixture's synthetic transport only after
    # runtime_case has installed it. Never replace or bypass that transport.
    case = request.getfixturevalue("runtime_case")

    import httpx

    from core.app.apps.workflow.stop_aware_ready_queue import StopAwareReadyQueue
    from core.helper import ssrf_proxy
    from graphon.engine_events import GraphRunStartedEvent, NodeRunStartedEvent
    from graphon.entities import WorkflowStartReason
    from runtime_contracts.builder.native.contracts import operation_digest
    from services.dify_builder.native_testing import runtime as runtime_module
    from services.dify_builder.native_testing.authorization import EffectAuthorizationService
    from services.dify_builder.native_testing.call_adapter import NativeCallAdapter
    from services.dify_builder.native_testing.context_runtime import NativeGraphRuntimeState
    from services.dify_builder.native_testing.host_execution import NativeHostLaunch
    from services.dify_builder.native_testing.http_adapter import NativeHttpClient
    from services.dify_builder.native_testing.http_binding import DeferredNativeHttpClient, NativeHttpBindingProducer
    from services.dify_builder.native_testing.runtime_bridge import NativeRuntimeBridge
    from services.workflow_runtime.entry import WorkflowEntry
    from services.workflow_runtime.node_factory import DifyNodeFactory

    lock = Lock()
    records: list[dict[str, object]] = []
    counts: Counter[str] = Counter()
    dropped = 0

    def note(stage: str, **facts: object) -> None:
        nonlocal dropped
        with lock:
            counts[stage] += 1
            if len(records) < _LIMIT:
                records.append({"stage": stage, **facts})
            else:
                dropped += 1

    def failure(stage: str, **facts: object) -> None:
        # Diagnostic failure cannot suppress/replace the real operation/error.
        note(stage + ".diagnostic_unavailable", **facts)

    ordinary_verbs = (
        ssrf_proxy.get,
        ssrf_proxy.post,
        ssrf_proxy.put,
        ssrf_proxy.patch,
        ssrf_proxy.delete,
        ssrf_proxy.head,
    )
    original_create = DifyNodeFactory.create_node

    @wraps(original_create)
    def create(factory, *args, **kwargs):
        node = original_create(factory, *args, **kwargs)
        try:
            bridge = factory._native_runtime
            note(
                "factory_node",
                node_digest=_digest(node.id),
                http=node.node_type == "http-request",
                bridge=type(bridge) is NativeRuntimeBridge,
                required=factory._dify_context.native_test_required,
                has_ref=factory._dify_context.native_test_ref is not None,
                native_runtime=type(node.runtime_state) is NativeGraphRuntimeState,
                boundary_owner=(bridge is not None and node._native_control_owner is bridge._boundary_owner),
                deferred_http=hasattr(node, "_http_client") and type(node._http_client) is DeferredNativeHttpClient,
            )
        except Exception:
            failure("factory_node")
        return node

    monkeypatch.setattr(DifyNodeFactory, "create_node", create)
    original_snapshot = NativeHostLaunch.snapshot_wait

    @wraps(original_snapshot)
    def snapshot(host):
        payload = original_snapshot(host)
        try:
            note(
                "checkpoint",
                generation=payload.generation,
                **_snapshot(payload.graph_runtime_state_json),
                journal_count=len(payload.node_journals),
                journal_digest=_digest(
                    [
                        [
                            list(item.occurrence_path),
                            item.cursor,
                            [operation_digest(key) for key in item.operation_keys],
                            len(item.result_refs),
                        ]
                        for item in payload.node_journals
                    ]
                ),
            )
        except Exception:
            failure("checkpoint")
        return payload

    monkeypatch.setattr(NativeHostLaunch, "snapshot_wait", snapshot)
    original_restore = runtime_module.restore_claimed_host

    @wraps(original_restore)
    def restore(**kwargs):
        actual = original_restore(**kwargs)
        try:
            note("restore", **_runtime_counts(actual.runtime_state))
        except Exception:
            failure("restore")
        return actual

    monkeypatch.setattr(runtime_module, "restore_claimed_host", restore)
    original_entry = WorkflowEntry.run

    @wraps(original_entry)
    def entry(owner):
        try:
            note("entry", **_runtime_counts(owner.graph_engine.runtime_state))
        except Exception:
            failure("entry")
        # Count reads above do not serialize or iterate queues.
        # yield from preserves send/throw/close delegation to the original.
        yield from original_entry(owner)

    monkeypatch.setattr(WorkflowEntry, "run", entry)
    original_observe = NativeHostLaunch._observe_root_event

    @wraps(original_observe)
    def observe(host, *, event, layer):
        value = original_observe(host, event=event, layer=layer)
        try:
            if isinstance(event, NodeRunStartedEvent):
                note("node_start", node_digest=_digest(event.node_id), execution_digest=_digest(event.id))
            elif isinstance(event, GraphRunStartedEvent):
                note("graph_start", resumed=event.reason is WorkflowStartReason.RESUMPTION)
            else:
                kind = type(event).__name__
                if kind in {
                    "GraphRunPausedEvent",
                    "GraphRunSucceededEvent",
                    "GraphRunFailedEvent",
                    "GraphRunAbortedEvent",
                }:
                    note(kind)
        except Exception:
            failure("event")
        return value

    monkeypatch.setattr(NativeHostLaunch, "_observe_root_event", observe)

    original_reject = StopAwareReadyQueue._should_reject

    @wraps(original_reject)
    def reject(owner):
        value = original_reject(owner)
        note("ready_reject", rejected=value, aborted=owner._graph_execution.aborted)
        return value

    monkeypatch.setattr(StopAwareReadyQueue, "_should_reject", reject)

    def wrap(owner, name, original, stage, *, identity=False, decision=False):

        @wraps(original)
        def observed(instance, *args, **kwargs):
            facts = {}
            if identity:
                try:
                    facts["operation_digest"] = operation_digest(kwargs["intent"].key)
                    facts["cursor"] = kwargs["intent"].key.cursor
                except Exception:
                    failure(stage)
            note(stage + ".enter", **facts)
            try:
                value = original(instance, *args, **kwargs)
            except BaseException:
                note(stage + ".raised", **facts)
                raise
            if decision:
                # The public decision union is fixed; never stringify a DTO.
                kind = type(value).__name__
                facts["decision"] = (
                    kind if kind in {"ApprovalWait", "DispatchPermit", "RecordedResult", "PolicyStop"} else "other"
                )
            note(stage + ".returned", **facts)
            return value

        monkeypatch.setattr(owner, name, observed)

    wrap(NativeHttpBindingProducer, "begin", NativeHttpBindingProducer.begin, "producer")
    wrap(NativeCallAdapter, "call", NativeCallAdapter.call, "scalar", identity=True)
    wrap(
        EffectAuthorizationService,
        "before_call",
        EffectAuthorizationService.before_call,
        "authorization",
        identity=True,
        decision=True,
    )
    wrap(
        EffectAuthorizationService, "claim_dispatch", EffectAuthorizationService.claim_dispatch, "claim", identity=True
    )
    wrap(NativeHttpClient, "_send_and_buffer", NativeHttpClient._send_and_buffer, "http_transport")
    wrap(httpx.Client, "send", httpx.Client.send, "fixture_send")
    try:
        yield
    finally:
        # No SQL reads are added here. Any still-running worker is left owned by
        # the unchanged test/runtime cleanup; this fixture never acknowledges it.
        with lock:
            receipt = {
                "version": 1,
                "counts": dict(counts),
                "records": list(records),
                "dropped": dropped,
                "fixture_send_count": len(case.sends),
                "ordinary_verb_call_counts": [
                    verb.call_count if hasattr(verb, "call_count") else None for verb in ordinary_verbs
                ],
            }
        record_property("native_resume_diagnostics", json.dumps(receipt, sort_keys=True, separators=(",", ":")))
