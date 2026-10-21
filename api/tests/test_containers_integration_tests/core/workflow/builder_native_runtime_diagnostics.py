"""Local and CI passive trace for the existing native runtime SQL witnesses.

Import only the fixture into test_builder_native_runtime.py. This module is not
an independently collected suite. No production hooks or logging are added.
Records contain fixed stage names, counts, booleans and SHA-256 identifiers.
No URLs, input/output values, serialized checkpoints, grant tokens or exception
text are emitted. Failure records add only exception types and fixed source frames.
Only the serialized payload returned by the real checkpoint is parsed. Restore
and entry observations read existing owners/counts without queue serialization.
No extra snapshot, dump, restore, graph or factory is constructed.
"""

from __future__ import annotations

import hashlib
import json
import sys
from collections import Counter
from collections.abc import Callable, Generator, Iterator
from functools import wraps
from threading import Lock
from typing import Protocol, cast

import pytest

from graphon.engine.layer import Layer
from graphon.engine_events import EngineEvent
from graphon.entities.base_node_data import BaseNodeData
from graphon.entities.graph_config import NodeConfigDict
from graphon.nodes.base.node import Node
from graphon.nodes.http_request.node import HttpRequestNode
from graphon.runtime import RuntimeState
from runtime_contracts.builder.native.contracts import EffectIntent
from runtime_contracts.builder.native.runtime_contracts import NativeCheckpointPayload
from services.dify_builder.native_testing.control import BoundaryOwnerState
from services.dify_builder.native_testing.lifecycle import NativeTestLifecycleService
from services.dify_builder.native_testing.runtime import NativeHostResumeBindings
from tests.test_containers_integration_tests.core.workflow.builder_native_fixture_records import RuntimeDeliveryCase


class _ObservedNativeNode(Protocol):
    _native_control_owner: BoundaryOwnerState


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


def _runtime_counts(runtime: RuntimeState) -> dict[str, object]:
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
def native_runtime_resume_diagnostics(
    request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch, record_property: Callable[[str, object], None]
) -> Iterator[None]:
    """Transparent, module-limited observation; execution/outcomes stay untouched."""
    if request.module.__name__ != _TARGET:
        yield
        return
    # Ordering is explicit: wrap the fixture's synthetic transport only after
    # runtime_case has installed it. Never replace or bypass that transport.
    case = cast(RuntimeDeliveryCase, request.getfixturevalue("runtime_case"))

    import httpx

    from core.app.apps.workflow.stop_aware_ready_queue import StopAwareReadyQueue
    from core.helper import ssrf_proxy
    from graphon.engine_events import GraphRunStartedEvent, NodeRunStartedEvent
    from graphon.entities import WorkflowStartReason
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from runtime_contracts.builder.native.contracts import operation_digest
    from services.dify_builder.native_testing import runtime as runtime_module
    from services.dify_builder.native_testing.authorization import EffectAuthorizationService
    from services.dify_builder.native_testing.call_adapter import NativeCallAdapter
    from services.dify_builder.native_testing.context_runtime import NativeGraphRuntimeState
    from services.dify_builder.native_testing.control import (
        NativeApprovalWait,
        NativePolicyStop,
    )
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

    def exception_facts(error: BaseException | None) -> dict[str, object]:
        if error is None:
            return {"active_exception": False}
        frames: list[list[str | int]] = []
        trace = error.__traceback__
        while trace is not None:
            module = trace.tb_frame.f_globals.get("__name__", "")
            if isinstance(module, str) and module.startswith("services.dify_builder.native_testing."):
                frames.append([module, trace.tb_frame.f_code.co_name, trace.tb_lineno])
            trace = trace.tb_next
        causes: list[dict[str, object]] = []
        cause = error.__cause__ if error.__cause__ is not None else error.__context__
        seen = {id(error)}
        while cause is not None and id(cause) not in seen and len(causes) < 8:
            seen.add(id(cause))
            cause_frames: list[list[str | int]] = []
            trace = cause.__traceback__
            while trace is not None:
                module = trace.tb_frame.f_globals.get("__name__", "")
                if isinstance(module, str):
                    cause_frames.append([module, trace.tb_frame.f_code.co_name, trace.tb_lineno])
                trace = trace.tb_next
            causes.append({"exception_type": type(cause).__name__, "frames": cause_frames})
            cause = cause.__cause__ if cause.__cause__ is not None else cause.__context__
        facts: dict[str, object] = {
            "active_exception": True,
            "exception_type": type(error).__name__,
            "exception_frames": frames,
            "exception_causes": causes,
        }
        if isinstance(error, (BuilderExecutionPolicyError, NativePolicyStop)):
            facts["reason_code"] = error.reason_code
        return facts

    original_private_unknown = NativeHostLaunch._unknown

    @wraps(original_private_unknown)
    def private_unknown(host: NativeHostLaunch) -> None:
        note(
            "host_private_unknown",
            generation=host.lifetime.generation,
            **exception_facts(sys.exception()),
        )
        return original_private_unknown(host)

    monkeypatch.setattr(NativeHostLaunch, "_unknown", private_unknown)
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
    def create(factory: DifyNodeFactory, node_config: dict[str, object] | NodeConfigDict) -> Node[BaseNodeData]:
        node = original_create(factory, node_config)
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
                boundary_owner=(
                    bridge is not None
                    and cast(_ObservedNativeNode, node)._native_control_owner is bridge._boundary_owner
                ),
                deferred_http=isinstance(node, HttpRequestNode) and type(node._http_client) is DeferredNativeHttpClient,
            )
        except Exception:
            failure("factory_node")
        return node

    monkeypatch.setattr(DifyNodeFactory, "create_node", create)
    original_snapshot = NativeHostLaunch.snapshot_wait

    @wraps(original_snapshot)
    def snapshot(host: NativeHostLaunch) -> NativeCheckpointPayload:
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
    def restore(
        *, host: NativeHostLaunch, lifecycle: NativeTestLifecycleService, expected_payload: NativeCheckpointPayload
    ) -> NativeHostResumeBindings:
        actual = original_restore(host=host, lifecycle=lifecycle, expected_payload=expected_payload)
        try:
            note("restore", **_runtime_counts(actual.runtime_state))
        except Exception:
            failure("restore")
        return actual

    monkeypatch.setattr(runtime_module, "restore_claimed_host", restore)
    original_entry = WorkflowEntry.run

    @wraps(original_entry)
    def entry(owner: WorkflowEntry) -> Generator[EngineEvent]:
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
    def observe(host: NativeHostLaunch, *, event: EngineEvent, layer: Layer) -> None:
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
    def reject(owner: StopAwareReadyQueue) -> bool:
        value = original_reject(owner)
        note("ready_reject", rejected=value, aborted=owner._graph_execution.aborted)
        return value

    monkeypatch.setattr(StopAwareReadyQueue, "_should_reject", reject)

    def wrap[**P, R](
        owner: type[object],
        name: str,
        original: Callable[P, R],
        stage: str,
        *,
        identity: bool = False,
        decision: bool = False,
    ) -> None:

        @wraps(original)
        def observed(*args: P.args, **kwargs: P.kwargs) -> R:
            facts: dict[str, object] = {}
            if identity:
                try:
                    intent = kwargs["intent"]
                    if not isinstance(intent, EffectIntent):
                        raise TypeError("native diagnostic intent")
                    facts["operation_digest"] = operation_digest(intent.key)
                    facts["cursor"] = intent.key.cursor
                except Exception:
                    failure(stage)
            note(stage + ".enter", **facts)
            try:
                value = original(*args, **kwargs)
            except BaseException as error:
                if isinstance(error, NativeApprovalWait):
                    note(stage + ".raised", **facts)
                else:
                    note(stage + ".raised", **facts, **exception_facts(error))
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
