"""Actual lifecycle routing; SQL boundary doubles do not establish durability."""

from __future__ import annotations

import json
from collections.abc import Callable, Generator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from threading import Thread, local
from typing import TYPE_CHECKING, Concatenate, Literal, NoReturn, Self, Unpack, cast, override

import pytest
from httpx._models import Response
from sqlalchemy import ColumnDefault, Select, inspect
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.sql.elements import BinaryExpression, ColumnClause
from typing_extensions import TypedDict

from core.dify_builder.models import Actor
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from graphon.engine.command import Command
from graphon.engine_events import EngineEvent
from graphon.entities.base_node_data import BaseNodeData
from graphon.enums import WorkflowExecutionStatus
from graphon.nodes.base.node import Node
from models.base import Base, TypeBase
from models.dify_builder import DifyBuilderExecutionRequest
from models.dify_builder_native_tests import NativeDispatch, NativeInvocationState, NativePayloadObject
from models.enums import WorkflowRunTriggeredFrom
from models.model import AppMode
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom, WorkflowRun
from runtime_contracts.builder.native.contracts import (
    CheckpointRef,
    DispatchPermit,
    EffectDecision,
    EffectIntent,
    EffectReceipt,
    JsonValue,
    NativeTestContextRef,
    OperationKey,
    Outcome,
    WaitingReceipt,
)
from runtime_contracts.builder.native.runtime_contracts import (
    NativeCheckpointPayload,
    NativeWorkflowOutcome,
    ResolvedNativeTestContext,
)
from services.dify_builder.native_testing.host_execution import _HostObservationLayer
from services.dify_builder.native_testing.http_binding import NativeHttpBindingResolver
from services.dify_builder.native_testing.lifecycle import NativeRuntimePort, NativeTestLifecycleService
from services.dify_builder.native_testing.repository import OwnedNativeTest, OwnedNativeTestLoader
from services.dify_builder.native_testing.runtime import DifyNativeRuntime, DifyNativeRuntimeOwner
from services.dify_builder.native_testing.runtime_bridge import NativeRuntimeBridge
from services.dify_builder.native_testing.state_store import NativeExecutionStateStore, ObjectReceipt
from tests.unit_tests.services.dify_builder.native_testing.test_host_capacity import Rows
from tests.unit_tests.services.dify_builder.native_testing.test_observation_owner import ObservationOwnerCase, case
from tests.unit_tests.services.dify_builder.native_testing.test_observation_privacy import context as sample_context

if TYPE_CHECKING:
    from contextlib import AbstractContextManager

    from services.dify_builder.native_testing.api_service import NativeTestApiService
    from services.dify_builder.native_testing.host_execution import NativeHostLaunch
    from services.dify_builder.native_testing.public_contracts import NativeTestPublicReceipt
    from tests.unit_tests.services.dify_builder.native_testing.test_host_capacity import SQL


class CleanupIdentity(TypedDict, closed=True):
    ref: NativeTestContextRef
    generation: int
    dispatch_id: str


class StopIdentity(TypedDict, closed=True):
    ref: NativeTestContextRef
    expected_generation: int
    dispatch_id: str
    reason_code: str


class NodeInputValues(TypedDict, closed=True):
    ref: NativeTestContextRef
    generation: int
    native_execution_id: str
    inputs: JsonValue


class EffectResultValues(TypedDict, closed=True):
    ref: NativeTestContextRef
    key: OperationKey
    result: JsonValue


class PauseValues(TypedDict, closed=True):
    checkpoint: CheckpointRef
    pending_operation_ids: tuple[str, ...]
    ref: NativeTestContextRef
    generation: int
    dispatch_id: str


@dataclass
class RestoredHostCase:
    host: NativeHostLaunch


class ImpostorResumeHost:
    def require_resume_bindings(self, **_kwargs: object) -> bool:
        return True


class HistoryQueryRows[T](Rows[T]):
    def scalars(self) -> Self:
        return self

    def first(self) -> T | None:
        return self[0] if self else None


@dataclass
class CancellationCase:
    api: NativeTestApiService
    owner: DifyNativeRuntimeOwner
    published: list[dict[str, JsonValue]]
    sql: SQL
    sessions: Callable[[], AbstractContextManager[SQL]]
    actor: Actor
    started: NativeTestPublicReceipt
    rows: dict[type[object], list[object]]


class _SqlDepth(local):
    def __init__(self) -> None:
        self.value = 0
        self.writers = 0


__all__ = ["case"]


def test_initial_dispatch_uses_no_checkpoint_and_duplicate_delivery_never_runs_again(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    context = sample_context()
    calls = []
    claimed = False

    class Runtime:
        def run_initial(self, *, context: ResolvedNativeTestContext) -> NativeWorkflowOutcome:
            calls.append(context)
            return NativeWorkflowOutcome(
                status="completed",
                ref=context.ref,
                native_run_id=context.native_run_id,
                checkpoint_ref=None,
                pending_operation_ids=(),
                reason_code=None,
                wait_reason=None,
                native_status="succeeded",
                output_result_ref=None,
            )

        def resume(self, **kwargs: object) -> NoReturn:
            del kwargs
            pytest.fail("initial delivery must not restore a checkpoint")

    class Store:
        def load_context(self, *, ref: NativeTestContextRef) -> ResolvedNativeTestContext:
            assert ref == context.ref
            return context

        def read_checkpoint(self, **kwargs: object) -> NoReturn:
            del kwargs
            pytest.fail("generation zero has no checkpoint")

    @contextmanager
    def locked(**kwargs: object) -> Generator[tuple[None, None, None]]:
        del kwargs
        yield None, None, None

    loader = OwnedNativeTestLoader(
        cast(sessionmaker[Session], lambda: pytest.fail("initial checkpoint SQL")),
        actor=Actor(tenant_id=context.tenant_id, account_id=context.actor_id),
        resolver=NativeHttpBindingResolver(),
    )
    monkeypatch.setattr(loader, "locked", locked)
    lifecycle = NativeTestLifecycleService(
        loader,
        state_store=cast(NativeExecutionStateStore, Store()),
        runtime=cast(NativeRuntimePort, Runtime()),
    )

    def claim(**kwargs: object) -> bool:
        del kwargs
        nonlocal claimed
        if claimed:
            return False
        claimed = True
        return True

    monkeypatch.setattr(lifecycle, "claim_dispatch", claim)
    monkeypatch.setattr(lifecycle, "finalize_dispatch_locked", lambda **kw: calls.append(kw["outcome"].status))
    result = lifecycle.execute_dispatch(ref=context.ref, generation=0, dispatch_id="dispatch")
    assert result is not None
    assert result.status == "completed"
    assert lifecycle.execute_dispatch(ref=context.ref, generation=0, dispatch_id="dispatch") is None
    assert calls == [context, "completed"]


@pytest.mark.parametrize(("dispatch_state", "cleaned"), [("claimed", True), ("completed", False), ("unknown", True)])
def test_resume_settlement_refuses_committed_wait_before_actual_finalization(
    dispatch_state: str, cleaned: bool
) -> None:
    from models.dify_builder import DifyBuilderExecutionRequest
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from runtime_contracts.builder.native.contracts import CheckpointRef
    from services.dify_builder.native_testing.http_binding import build_native_http_profile
    from services.dify_builder.native_testing.runtime import DifyNativeResumeSettlement
    from tests.unit_tests.services.dify_builder.native_testing.test_host_capacity import SQL

    context = sample_context()
    owned = OwnedNativeTest(
        session_id="session",
        test_input_id="input",
        bindings={},
        generation=0,
        task_approved=False,
        expires_at=datetime(2030, 1, 1, tzinfo=UTC),
        state="running",
        ref=context.ref,
        tenant_id=context.tenant_id,
        actor_id=context.actor_id,
        app_id=context.app_id,
        workflow_id=context.workflow_id,
    )
    state = NativeInvocationState(
        generation=0,
        cleanup_complete=cleaned,
        checkpoint_id="checkpoint",
        tenant_id=context.tenant_id,
        request_id=context.ref.request_id,
        invocation_id=context.ref.invocation_id,
        context_object_id="context",
        state="waiting",
        pending_ids=[],
        resolution=[],
    )
    rows = {
        DifyBuilderExecutionRequest: [
            DifyBuilderExecutionRequest(
                app_id=context.app_id,
                workflow_id=context.workflow_id,
                session_id="session",
                test_input_id="input",
                context_digest=context.ref.context_digest,
                id=context.ref.request_id,
                tenant_id=context.tenant_id,
                actor_id=context.actor_id,
                context={"profile": build_native_http_profile().model_dump(mode="json")},
            )
        ],
        NativeDispatch: [
            NativeDispatch(
                idempotency_digest="a" * 64,
                tenant_id=context.tenant_id,
                request_id=context.ref.request_id,
                invocation_id=context.ref.invocation_id,
                generation=0,
                state=dispatch_state,
            )
        ],
    }
    validator = DifyNativeResumeSettlement()
    with pytest.raises(BuilderExecutionPolicyError, match="native_resume_unsettled"):
        validator.validate(
            session=SQL(rows, []),
            owned=owned,
            state=state,
            checkpoint=CheckpointRef(checkpoint_id="checkpoint", payload_digest="a" * 64),
        )


def test_unrestored_host_cannot_authorize_arbitrary_snapshot_or_resume_history() -> None:
    from tests.unit_tests.services.dify_builder.native_testing.test_host_execution import LaunchCase

    case = LaunchCase()
    with pytest.raises(ValueError, match="native_resume_unavailable"):
        case.host.require_resume_bindings(entity=object(), runtime_state=object(), response_filter=object())


def test_actual_delivery_capacity_is_bound_before_claim_but_lifetime_stays_inactive(
    case: ObservationOwnerCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    from services.dify_builder.native_testing.host_lifetime import NativeHostLifetimeRegistry
    from services.dify_builder.native_testing.lifecycle import NativeDispatchRef
    from services.dify_builder.native_testing.runtime import DifyNativeResumeSettlement, DifyNativeRuntime
    from tests.unit_tests.services.dify_builder.native_testing.test_native_observation_wiring import protect_logs

    protect_logs(monkeypatch)
    lifecycle = NativeTestLifecycleService(
        case.loader, state_store=case.store, resume_settlement=DifyNativeResumeSettlement()
    )
    runtime = DifyNativeRuntime(
        delivery=NativeDispatchRef(case.context.ref, 0, "actual-delivery"),
        lifecycle=lifecycle,
        registry=NativeHostLifetimeRegistry(),
    )
    assert lifecycle._capacity is runtime.capacity
    assert runtime.capacity._verifier is runtime.host.lifetime
    with pytest.raises(ValueError, match="native_host_acquisition_not_current"):
        runtime.host.lifetime.require_settled_root()
    assert runtime.recovery_evidence(context=case.context, dispatch_id="actual-delivery") == "unknown"


def test_broker_actor_hint_cannot_replace_persisted_request_owner(case: ObservationOwnerCase) -> None:
    from core.dify_builder.models import Actor
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from services.dify_builder.native_testing.lifecycle import NativeDispatchRef
    from services.dify_builder.native_testing.runtime import DifyNativeRuntimeOwner

    with pytest.raises(BuilderExecutionPolicyError, match="native_owner_mismatch"):
        DifyNativeRuntimeOwner().delivery(
            sessions=case.loader.session_factory,
            delivery=NativeDispatchRef(case.context.ref, 0, "actual-delivery"),
            actor_hint=Actor(account_id="foreign", tenant_id=case.context.tenant_id),
        )


@pytest.mark.parametrize("generation", [1, 7])
def test_actual_wait_snapshot_restores_exact_objects_journal_and_generation_gap(
    monkeypatch: pytest.MonkeyPatch, generation: int
) -> None:
    """Actual Graphon wait/snapshot/restore; C03 claim/readback/ACK are labeled doubles."""
    from runtime_contracts.builder.native.contracts import CheckpointRef
    from services.dify_builder.native_testing.checkpoint_bridge import NativeCheckpointBridge
    from services.dify_builder.native_testing.host_execution import NativeHostLaunch
    from services.dify_builder.native_testing.host_lifetime import NativeHostLifetime
    from services.dify_builder.native_testing.operation_journal import NodeOperationJournal
    from services.dify_builder.native_testing.runtime import DifyNativeResumeSettlement
    from tests.unit_tests.services.dify_builder.native_testing.test_native_observation_wiring import (
        bind_component_observation,
    )
    from tests.unit_tests.services.dify_builder.native_testing.test_stream_runtime import StreamCase

    initial = StreamCase(monkeypatch, waiting=True)
    initial.start()
    assert initial.consume().status == "waiting"
    payload = initial.saved
    assert payload is not None
    state, auth = initial.case.state, initial.case.authorization
    state.context = state.context.model_copy(update={"generation": generation})
    loader = OwnedNativeTestLoader(
        cast(sessionmaker[Session], initial.sessions),
        actor=Actor(tenant_id=state.context.tenant_id, account_id=state.context.actor_id),
        resolver=NativeHttpBindingResolver(),
    )
    lifecycle = NativeTestLifecycleService(
        loader,
        state_store=cast(NativeExecutionStateStore, state),
        resume_settlement=DifyNativeResumeSettlement(),
    )
    checkpoint = CheckpointRef(checkpoint_id="checkpoint", payload_digest="c" * 64)

    def claimed(**kwargs: object) -> CheckpointRef:
        assert kwargs == {"ref": state.context.ref, "generation": generation, "dispatch_id": "resume-delivery"}
        return checkpoint

    monkeypatch.setattr(lifecycle, "claimed_resume_checkpoint", claimed)

    def read_checkpoint(**kwargs: object) -> NativeCheckpointPayload:
        assert kwargs == {"ref": state.context.ref, "checkpoint": checkpoint}
        return payload.model_copy(deep=True)

    monkeypatch.setattr(state, "read_checkpoint", read_checkpoint)
    journal = NodeOperationJournal(state=state, authorization=auth)
    life = NativeHostLifetime(context=state.context, dispatch_id="resume-delivery")
    initial.case.registry.activate(lifetime=life)
    host = NativeHostLaunch(
        context=state.context,
        dispatch_id=life.dispatch_id,
        lifetime=life,
        journal=journal,
        checkpoints=NativeCheckpointBridge(state=state, lifecycle=lifecycle),
        fence_pending=initial.case.ports.fence_pending,
        stop_sealer=initial.case.ports,
        authorization=auth,
        http_baseline=(1, 1, 1),
    )
    bind_component_observation(RestoredHostCase(host=host), monkeypatch)
    restored = host.restore_claimed_resume(lifecycle=lifecycle, expected_payload=payload)
    assert restored.entity.workflow_execution_id == payload.native_run_id
    assert restored.entity.native_test_ref == state.context.ref
    assert restored.runtime_state.graph_execution.paused
    assert journal.snapshot(ref=state.context.ref) == payload.node_journals
    assert (
        host.require_resume_bindings(
            entity=restored.entity, runtime_state=restored.runtime_state, response_filter=restored.response_filter
        )
        is restored
    )
    with pytest.raises(ValueError, match="native_resume_identity_mismatch"):
        host.require_resume_bindings(
            entity=restored.entity.model_copy(),
            runtime_state=restored.runtime_state,
            response_filter=restored.response_filter,
        )
    with pytest.raises(ValueError, match="native_resume_replayed"):
        host.restore_claimed_resume(lifecycle=lifecycle, expected_payload=payload)


def test_actual_stream_cleanup_returns_without_signalling_retired_host(monkeypatch: pytest.MonkeyPatch) -> None:
    from services.dify_builder.native_testing.generation_wiring import HostOwnedNativeGeneratorStream
    from services.dify_builder.native_testing.native_execution import DifyNativeWorkflowOwner
    from tests.unit_tests.services.dify_builder.native_testing.test_host_generation_wiring import runtime_for
    from tests.unit_tests.services.dify_builder.native_testing.test_stream_runtime import StreamCase

    c = StreamCase(monkeypatch)
    c.start()
    owner = DifyNativeWorkflowOwner(
        session_factory=cast(sessionmaker[Session], c.sessions),
        runtime=runtime_for(c.case),
        stream_owner=c.owner(),
        native_host=c.case.host,
    )
    stream = HostOwnedNativeGeneratorStream(source=c.source(), host=c.case.host)
    result = owner._consume(context=c.case.state.context, stream=stream)
    assert result.status == "completed"
    assert c.case.lifetime._consumed
    assert len(c.source_closed) == 1
    assert c.events[-1] == "release"


def test_unknown_joined_owner_can_release_only_actual_dead_dispatcher_lease(monkeypatch: pytest.MonkeyPatch) -> None:
    from tests.unit_tests.services.dify_builder.native_testing.test_stream_runtime import StreamCase

    c = StreamCase(monkeypatch)
    monkeypatch.setattr(c, "source_error", RuntimeError("private-reader-canary"))
    c.start()
    assert c.consume().status == "unknown"
    assert c.case.lifetime.unknown
    assert c.case.host._dispatcher_log_leases
    c.case.host.release_dead_dispatcher_logs()
    assert c.case.host._dispatcher_log_leases == []
    assert c.case.lifetime.unknown
    # Real physical verifier still owns the separate source/worker/ticket checks.
    c.case.lifetime.consume_cleanup(
        ref=c.case.lifetime.ref, generation=c.case.lifetime.generation, dispatch_id=c.case.lifetime.dispatch_id
    )


def test_cleanup_only_log_release_refuses_live_dispatcher_and_keeps_original_lease(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from threading import Event, Thread

    from graphon.engine.command import InMemoryChannel
    from libs.sensitive_http_telemetry import SensitiveHttpTelemetryUnavailable
    from tests.unit_tests.services.dify_builder.native_testing.test_host_execution import LaunchCase
    from tests.unit_tests.services.dify_builder.native_testing.test_native_observation_wiring import (
        bind_component_observation,
    )

    c = LaunchCase(baseline=(1, 1, 1))
    bind_component_observation(c, monkeypatch)
    entered, leave = Event(), Event()
    channel = InMemoryChannel()

    def fetch() -> list[Command]:
        entered.set()
        assert leave.wait(3)
        return []

    monkeypatch.setattr(channel, "fetch_commands", fetch)
    wrapped = c.host.wrap_commands(channel=channel)
    thread = Thread(target=wrapped.fetch_commands)
    thread.start()
    try:
        assert entered.wait(2)
        original = tuple(c.host._dispatcher_log_leases)
        c.host.mark_unknown()
        with pytest.raises(SensitiveHttpTelemetryUnavailable):
            c.host.release_dead_dispatcher_logs()
        assert tuple(c.host._dispatcher_log_leases) == original
        assert thread.is_alive()
    finally:
        leave.set()
        thread.join(3)
    c.host.release_dead_dispatcher_logs()
    assert c.lifetime.unknown
    # No worker/source existed, but observed dispatcher history disqualifies
    # the genuine never-started alternative and physical consumption still fails.
    with pytest.raises(ValueError, match="^native_host_never_started_unproven$"):
        c.host.confirm_never_started()
    with pytest.raises(ValueError, match="^native_host_cleanup_incomplete$"):
        c.lifetime.consume_cleanup(
            ref=c.lifetime.ref, generation=c.lifetime.generation, dispatch_id=c.lifetime.dispatch_id
        )


def test_resume_history_refuses_fake_host_before_any_repository_cache_or_io() -> None:
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from services.dify_builder.native_testing.runtime import read_claimed_history

    touched: list[tuple[tuple[object, ...], dict[str, object]]] = []

    def repository(*args: object, **kwargs: object) -> NoReturn:
        touched.append((args, kwargs))
        raise AssertionError("history IO before actual host")

    with pytest.raises(BuilderExecutionPolicyError, match="native_resume_owner_mismatch"):
        read_claimed_history(
            host=ImpostorResumeHost(),
            entity=object(),
            workflow_repository=repository,
            node_repository=repository,
        )
    assert touched == []


@pytest.mark.parametrize(
    ("kind", "history_fault"),
    [
        ("root", None),
        ("loop", None),
        ("iteration", None),
        ("root", "missing"),
        ("root", "foreign"),
        ("root", "redirect"),
        ("root", "initial-stop"),
        *[
            ("root", "redirect-" + fault)
            for fault in (
                "owner",
                "generation",
                "dispatch",
                "cancelled",
                "ambiguous",
                "unacknowledged",
                "checkpoint",
                "run",
                "transition",
            )
        ],
        ("loop", "price-nonzero"),
        ("loop", "price-nan"),
        ("iteration", "price-inf"),
        ("loop", "price-foreign"),
    ],
)
def test_real_dify_initial_http_wait_and_claimed_resume_keep_same_run(
    case: ObservationOwnerCase, monkeypatch: pytest.MonkeyPatch, kind: str, history_fault: None | str
) -> None:
    """Actual Dify generator/runner/Graphon; SQL/storage/C02/quota/HTTP doubles.

    This proves the composition, never database durability or grant authority.
    The separate CI witness runs the actual SQL owners and operation approval.
    """
    from copy import deepcopy

    import httpx
    from flask import Flask
    from flask_sqlalchemy import SQLAlchemy
    from sqlalchemy.orm import sessionmaker

    from core.app.features.rate_limiting import RateLimit
    from core.repositories.factory import DifyCoreRepositoryFactory
    from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
    from core.repositories.sqlalchemy_workflow_node_execution_repository import (
        SQLAlchemyWorkflowNodeExecutionRepository,
    )
    from models.account import Account, AccountStatus
    from models.model import App
    from models.workflow import Workflow, WorkflowRun
    from runtime_contracts.builder.native.contracts import ApprovalWait, CheckpointRef, WaitingReceipt
    from services.dify_builder.native_testing import authorization as authorization_module
    from services.dify_builder.native_testing.host_lifetime import NativeHostLifetimeRegistry
    from services.dify_builder.native_testing.http_binding import NativeHttpBindingProducer
    from services.dify_builder.native_testing.lifecycle import NativeDispatchRef
    from services.dify_builder.native_testing.runtime import DifyNativeResumeSettlement, DifyNativeRuntime
    from services.workflow_runtime import workflow_generator as generator_module
    from tests.unit_tests.services.dify_builder.native_testing.test_host_capacity import SQL, Rows
    from tests.unit_tests.services.dify_builder.native_testing.test_native_observation_wiring import protect_logs

    protect_logs(monkeypatch)
    import threading
    from decimal import Decimal

    from services.dify_builder.native_testing.host_execution import NativeHostLaunch
    from services.dify_builder.native_testing.observation_adapters import NativeObservationError

    thread_errors = []
    monkeypatch.setattr(threading, "excepthook", lambda args: thread_errors.append(args.exc_value))
    normalized: list[str] = []
    original_diagnostic = NativeHostLaunch.diagnostic_event

    def diagnostic(host: NativeHostLaunch, *, event: EngineEvent) -> EngineEvent:
        maps = [(name, dict(event).get(name)) for name in ("metadata", "execution_metadata")]
        for name, values in maps:
            if type(values) is dict and type(values.get("total_price")) is Decimal:
                before = event.model_copy(deep=True)
                if history_fault and history_fault.startswith("price-") and host.lifetime.generation == 1:
                    bad = {
                        "price-nonzero": Decimal(1),
                        "price-nan": Decimal("NaN"),
                        "price-inf": Decimal("Infinity"),
                        "price-foreign": Decimal(0),
                    }[history_fault]
                    changed: dict[str, object] = {name: {**values, "total_price": bad}}
                    if history_fault == "price-foreign":
                        changed["id"] = "foreign-occurrence"
                    candidate = event.model_copy(update=changed)
                    with pytest.raises(NativeObservationError, match="native_observation_failed"):
                        original_diagnostic(host, event=candidate)
                    assert event == before
                    raise NativeObservationError()
                observed = original_diagnostic(host, event=event)
                assert event == before
                assert type(values["total_price"]) is Decimal
                assert type(dict(observed)[name]["total_price"]) is int
                assert dict(observed)[name]["total_price"] == 0
                assert {k: v for k, v in dict(observed)[name].items() if k != "total_price"} == {
                    k: v for k, v in values.items() if k != "total_price"
                }
                normalized.append(kind)
                return observed
        return original_diagnostic(host, event=event)

    monkeypatch.setattr(NativeHostLaunch, "diagnostic_event", diagnostic)
    from services.dify_builder.native_testing.host_execution import _HostObservationLayer

    original_node_context = _HostObservationLayer.node_run_context
    checked_live_phase: list[str] = []

    @contextmanager
    def node_context(
        layer: _HostObservationLayer, node: Node[BaseNodeData], *, parent_execution_id: str | None = None
    ) -> Generator[None]:
        # Graphon 0.8 owns each activation's lexical node_run_context. A paused
        # container releases its worker context here; no root callback closes
        # another thread's retained hook/context as the former helper did.
        host = layer._host
        with original_node_context(layer, node, parent_execution_id=parent_execution_id):
            hook = next(item for item in layer._hooks if item.node is node)
            assert hook.thread is threading.current_thread()
            assert hook.execution_id == node.execution_id
            assert host.lifetime.active_node_scopes
            if kind != "root" and node.node_type == kind:
                assert threading.current_thread() is not host._worker
                other_layer = _HostObservationLayer(host)
                other_layer.on_graph_end(None)
                assert hook in layer._hooks
                layer.on_graph_end(RuntimeError("private-end-canary"))
                assert hook in layer._hooks
                actual_id = node.execution_id
                node.bind_execution_id("foreign-occurrence")
                layer.on_graph_end(None)
                assert hook in layer._hooks
                node.bind_execution_id(actual_id)
                terminal = host._root_terminal
                host._root_terminal = None
                layer.on_graph_end(None)
                assert hook in layer._hooks
                host._root_terminal = terminal
                with host.node_scope(node=node, phase="resume_container"):
                    layer.on_graph_end(None)
                    assert hook in layer._hooks
                    assert host.lifetime.active_node_scopes
                checked_live_phase.append(kind)
            elif kind != "root" and node.node_type == "start":
                # A scalar activation likewise remains owned by this context,
                # not a root or nested container completion callback.
                layer.on_graph_end(None)
                assert hook in layer._hooks
            yield
        assert hook not in layer._hooks

    monkeypatch.setattr(_HostObservationLayer, "node_run_context", node_context)
    from models.dify_builder import DifyBuilderTestInput
    from runtime_contracts.builder.execution import canonical_digest
    from services.dify_builder.native_testing.context_binding import native_workflow_revision
    from services.dify_builder.native_testing.http_binding import describe_http_resource
    from tests.unit_tests.services.dify_builder.native_testing.test_native_observation_wiring import supported_graph

    context = case.context
    if kind != "root":
        graph = supported_graph(kind)
        inputs = {**context.inputs, "items": ["one", "two"]}
        case.workflow.graph = json.dumps(graph)
        revision = native_workflow_revision(case.workflow)
        manifest = tuple(
            describe_http_resource(
                node_id=node["id"],
                raw=node["data"],
                workflow_revision=revision,
                app_id=context.app_id,
                workflow_id=context.workflow_id,
            )
            for node in graph["nodes"]
            if node["data"]["type"] == "http-request"
        )
        case.request.context.update(
            execution_revision=revision,
            input_revision=canonical_digest(inputs),
            resource_manifest_digest=canonical_digest(list(manifest)),
        )
        case.context = context.model_copy(
            update={
                "graph": graph,
                "graph_revision": revision,
                "resource_manifest": manifest,
                "inputs": inputs,
                "input_revision": canonical_digest(inputs),
            },
            deep=True,
        )
        cast(DifyBuilderTestInput, case.rows[DifyBuilderTestInput][0]).inputs = inputs
        case.rebind()
        context = case.context
    workflow = Workflow(
        id=context.workflow_id,
        tenant_id=context.tenant_id,
        app_id=context.app_id,
        type="workflow",
        version="draft",
        kind="standard",
        graph=json.dumps(context.graph),
        _features="{}",
        _environment_variables="{}",
        _conversation_variables="{}",
        created_by=context.actor_id,
    )
    app = App(id=context.app_id, tenant_id=context.tenant_id, mode="workflow", status="normal", name="Component")
    account = Account(name="Component", email="component@example.invalid")
    account.id, account.status = context.actor_id, AccountStatus.ACTIVE
    case.rows[Workflow], case.rows[App], case.rows[Account] = (
        cast(list[object], [workflow]),
        cast(list[object], [app]),
        cast(list[object], [account]),
    )

    class HistorySQL(SQL):
        """Actual SQL-repository protocol boundary, including pre-cache owner reads."""

        writing = False

        def __call__(self, **kw: object) -> Self:
            del kw
            return self

        def __enter__(self) -> Self:
            return self

        def __exit__(self, *args: object) -> None:
            self.writing = False

        def begin(self) -> Self:
            self.writing = True
            return self

        @override
        def get[T](self, model: type[T], identity: object, **kw: object) -> T | None:
            if kw.get("with_for_update"):
                self.writing = True
            return super().get(model, identity)

        def merge(self, row: WorkflowRun | WorkflowNodeExecutionModel) -> WorkflowRun | WorkflowNodeExecutionModel:
            previous = self.get(type(row), row.id)
            if previous is not None:
                self.rows[type(row)].remove(previous)
            self.rows.setdefault(type(row), []).append(row)
            return row

        def commit(self) -> None:
            pass

        def close(self) -> None:
            pass

        def expunge_all(self) -> None:
            pass

        @override
        def execute[T: tuple[object, ...]](self, _query: Select[T]) -> Rows[T]:
            # This labeled boundary returns its scalar-owner rows to .scalars().
            values = self.scalars(cast(Select[tuple[object]], _query))
            return cast(Rows[T], HistoryQueryRows(values))

    history = HistorySQL(case.rows, [])
    # The reused single-reader fixture's global SQL depth is unsuitable for
    # actual concurrent workers. This boundary retains per-thread no-IO-in-SQL
    # assertions; it does not replace the production ownership reads.

    sql_depth = _SqlDepth()

    @contextmanager
    def concurrent_sessions() -> Generator[SQL]:
        sql_depth.value = sql_depth.value + 1
        try:
            yield SQL(case.rows, case.events)
        finally:
            sql_depth.value -= 1

    case.loader.session_factory = cast(sessionmaker[Session], concurrent_sessions)
    if history_fault is not None and (history_fault.startswith("redirect") or history_fault == "initial-stop"):
        monkeypatch.setattr(concurrent_sessions, "begin", concurrent_sessions, raising=False)

        @contextmanager
        def stop_writer(
            *, ref: NativeTestContextRef, settlement: bool
        ) -> Generator[tuple[SQL, OwnedNativeTest, object]]:
            assert settlement is True
            owned = case.loader.load(ref=ref)
            with concurrent_sessions() as session:
                from models.dify_builder_native_tests import NativeTestScope

                yield session, owned, cast(NativeTestScope, case.rows[NativeTestScope][0])

        monkeypatch.setattr(case.loader, "locked", stop_writer)
        case.local.state = "running"
        case.local.cleanup_complete = False

    def permission(actor: Actor, app_id: str, sessions: object) -> None:
        assert sql_depth.value == 0
        assert actor == case.loader.actor
        assert app_id == context.app_id
        assert sessions is concurrent_sessions

    for permission_path in (
        "services.dify_builder.execution_policy_service.check_execution_permission",
        "services.dify_builder.native_testing.private_reads.check_execution_permission",
        "services.dify_builder.native_testing.http_binding.check_execution_permission",
    ):
        monkeypatch.setattr(permission_path, permission)

    def protected_context(row: NativePayloadObject) -> dict[str, object]:
        assert sql_depth.value == 0
        assert row.id == "context"
        return deepcopy(case.context.model_dump(mode="json"))

    monkeypatch.setattr(NativeExecutionStateStore, "_read_object", staticmethod(protected_context))
    monkeypatch.setattr(SQL, "expunge_all", lambda _self: None, raising=False)
    # The loader's SQL boundary is a function fixture, while actual repository
    # constructors require a nominal sessionmaker. Retain their real setup,
    # replacing only that constructor's SQL session boundary in both deliveries.

    def repository_constructor[
        R: SQLAlchemyWorkflowExecutionRepository | SQLAlchemyWorkflowNodeExecutionRepository,
        **P,
    ](
        original: Callable[Concatenate[R, sessionmaker[Session], P], None],
    ) -> Callable[Concatenate[R, sessionmaker[Session], P], None]:
        def initialize(repo: R, session_factory: sessionmaker[Session], *args: P.args, **kwargs: P.kwargs) -> None:
            del session_factory
            original(repo, sessionmaker(), *args, **kwargs)
            repo._session_factory = cast(sessionmaker[Session], history)

        return initialize

    monkeypatch.setattr(
        SQLAlchemyWorkflowExecutionRepository,
        "__init__",
        repository_constructor(SQLAlchemyWorkflowExecutionRepository.__init__),
    )
    monkeypatch.setattr(
        SQLAlchemyWorkflowNodeExecutionRepository,
        "__init__",
        repository_constructor(SQLAlchemyWorkflowNodeExecutionRepository.__init__),
    )

    def repositories(
        *, node: bool = False, **kwargs: object
    ) -> SQLAlchemyWorkflowExecutionRepository | SQLAlchemyWorkflowNodeExecutionRepository:
        repo = (
            SQLAlchemyWorkflowNodeExecutionRepository(
                sessionmaker(),
                context.tenant_id,
                account,
                context.app_id,
                cast(WorkflowNodeExecutionTriggeredFrom, kwargs["triggered_from"]),
            )
            if node
            else SQLAlchemyWorkflowExecutionRepository(
                sessionmaker(),
                context.tenant_id,
                account,
                context.app_id,
                cast(WorkflowRunTriggeredFrom, kwargs["triggered_from"]),
            )
        )
        repo._session_factory = cast(sessionmaker[Session], history)
        return repo

    monkeypatch.setattr(DifyCoreRepositoryFactory, "create_workflow_execution_repository", repositories)
    monkeypatch.setattr(
        DifyCoreRepositoryFactory,
        "create_workflow_node_execution_repository",
        lambda **kw: repositories(node=True, **kw),
    )
    monkeypatch.setattr(generator_module.session_factory, "create_session", lambda: history)
    database = SQLAlchemy()
    monkeypatch.setattr(generator_module, "db", database)
    monkeypatch.setattr(generator_module, "sessionmaker", lambda **_kw: sessionmaker())
    from core.app.apps import base_app_queue_manager
    from tests.unit_tests.services.dify_builder.native_testing.test_observation_stream import bind_queue_cache

    bind_queue_cache(monkeypatch)
    monkeypatch.setattr(base_app_queue_manager.AppQueueManager, "_is_stopped", lambda _self: False)
    monkeypatch.setattr(RateLimit, "flush_cache", lambda *_args, **_kw: None)
    for name in ("enter", "exit"):
        monkeypatch.setattr(RateLimit, name, lambda _self, request_id: request_id)
    monkeypatch.setattr(RateLimit, "_get_max_active_requests", lambda *_args: 10, raising=False)

    class ComponentAuthorization:
        """C02 boundary keyed by full operation, including parallel occurrences."""

        def __init__(self) -> None:
            from threading import RLock

            self.lock = RLock()
            self.decisions = {0: True}
            self.permits: dict[str, DispatchPermit] = {}
            self.outcomes: dict[str, str] = {}
            self.claimed: set[str] = set()

        def before_call(self, *, ref: NativeTestContextRef, intent: EffectIntent) -> EffectDecision:
            from runtime_contracts.builder.native.contracts import DispatchPermit, RecordedResult, operation_digest

            assert ref == context.ref
            key = operation_digest(intent.key)
            with self.lock:
                if history_fault == "initial-stop":
                    from runtime_contracts.builder.native.contracts import PolicyStop

                    return PolicyStop(reason_code="effect_denied")
                if self.decisions:
                    return ApprovalWait(pending_operation_id="pending-" + key, wait_reason="approval")
                if key in self.outcomes:
                    return RecordedResult(operation_id=key, result_ref=self.outcomes[key])
                return self.permits.setdefault(
                    key,
                    DispatchPermit(permit_id=key, attempt_id=key, operation_id=key, expires_at="2030-01-01T00:00:00Z"),
                )

        def claim_dispatch(self, *, ref: NativeTestContextRef, intent: EffectIntent, permit: DispatchPermit) -> None:
            from runtime_contracts.builder.native.contracts import operation_digest

            assert ref == context.ref
            key = operation_digest(intent.key)
            with self.lock:
                assert permit is self.permits[key]
                assert key not in self.claimed
                self.claimed.add(key)

        def record_outcome(self, *, permit: DispatchPermit, outcome: Outcome, result_ref: str) -> EffectReceipt:
            from runtime_contracts.builder.native.contracts import EffectReceipt

            with self.lock:
                assert permit is self.permits[permit.operation_id]
                assert outcome == "completed"
                self.outcomes[permit.operation_id] = result_ref
            return EffectReceipt(
                operation_id=permit.operation_id, attempt_id=permit.attempt_id, outcome=outcome, result_ref=result_ref
            )

    auth = ComponentAuthorization()
    monkeypatch.setattr(authorization_module, "EffectAuthorizationService", lambda _loader: auth)
    private: dict[str, JsonValue] = {}
    checkpoints: dict[str, NativeCheckpointPayload] = {}
    sends: list[tuple[str, str]] = []
    seal_errors: list[BaseException] = []
    transition_threads: list[Thread] = []
    transition_errors: list[BaseException] = []

    def store_inputs(**kw: Unpack[NodeInputValues]) -> str:
        key = "input-" + kw["native_execution_id"]
        private[key] = deepcopy(kw["inputs"])
        return key

    def store_result(**kw: Unpack[EffectResultValues]) -> str:
        from uuid import uuid4

        key = "result-" + str(uuid4())
        private[key] = deepcopy(kw["result"])
        return key

    monkeypatch.setattr(case.store, "store_node_inputs", store_inputs)
    monkeypatch.setattr(case.store, "store_result", store_result)
    monkeypatch.setattr(case.store, "load_result", lambda **kw: deepcopy(private[kw["result_ref"]]))
    monkeypatch.setattr(NativeHttpBindingProducer, "_install", lambda *_args, **_kw: None)
    checkpoint_ref = CheckpointRef(checkpoint_id="component-checkpoint", payload_digest="c" * 64)
    monkeypatch.setattr(
        case.store,
        "commit_checkpoint",
        lambda **kw: checkpoints.setdefault("payload", kw["payload"]) and checkpoint_ref,
    )
    monkeypatch.setattr(case.store, "read_checkpoint", lambda **_kw: checkpoints["payload"].model_copy(deep=True))

    def transport(method: str, url: str, **kw: object) -> Response:
        del kw
        sends.append((method, url))
        return httpx.Response(
            302
            if history_fault is not None and (history_fault.startswith("redirect") or history_fault == "initial-stop")
            else 200,
            content=b'{"ok":true}',
            headers={
                "content-type": "application/json",
                **(
                    {"Location": "https://example.com/redirect"}
                    if history_fault is not None
                    and (history_fault.startswith("redirect") or history_fault == "initial-stop")
                    else {}
                ),
            },
            request=httpx.Request(method, url),
        )

    monkeypatch.setattr("core.helper.ssrf_proxy.make_request", transport)
    registry = NativeHostLifetimeRegistry()

    def prepare(generation: int) -> DifyNativeRuntime:
        from models.dify_builder_native_tests import NativeContinuation

        lifecycle = NativeTestLifecycleService(
            case.loader, state_store=case.store, resume_settlement=DifyNativeResumeSettlement()
        )
        monkeypatch.setattr(lifecycle, "fence_pending", lambda **_kw: None)
        if history_fault is not None and (history_fault.startswith("redirect") or history_fault == "initial-stop"):
            actual_seal = lifecycle.seal_stop

            def checked_seal(**kw: Unpack[StopIdentity]) -> object | None:
                try:
                    result = actual_seal(**kw)
                    if generation:
                        restored = runtime.host.resume_bindings
                        from runtime_contracts.builder.execution import BuilderExecutionPolicyError

                        with pytest.raises(BuilderExecutionPolicyError):
                            runtime.host.require_resume_bindings(
                                entity=restored.entity,
                                runtime_state=restored.runtime_state,
                                response_filter=restored.response_filter,
                            )
                        with pytest.raises(BuilderExecutionPolicyError):
                            NativeTestLifecycleService.claimed_resume_checkpoint(
                                lifecycle, ref=context.ref, generation=generation, dispatch_id=f"delivery-{generation}"
                            )
                    from models.dify_builder_native_tests import NativeTestScope

                    if history_fault == "redirect-transition":
                        from threading import Event, Thread

                        attempted, finished = Event(), Event()

                        def observe_after_commit() -> None:
                            attempted.set()
                            try:
                                _ = runtime.host.native_observation
                                restored = runtime.host.resume_bindings
                                runtime.host.require_resume_projection_bindings(
                                    entity=restored.entity,
                                    runtime_state=restored.runtime_state,
                                    response_filter=restored.response_filter,
                                )
                            except BaseException as error:
                                transition_errors.append(error)
                            finally:
                                finished.set()

                        thread = Thread(target=observe_after_commit)
                        transition_threads.append(thread)
                        thread.start()
                        assert attempted.wait(1)
                        # Hold the known committed seal before its ACK, while
                        # an actual concurrent projection tries to read.
                        finished.wait(0.05)
                    if history_fault == "redirect-owner":
                        case.local.app_id = "foreign-app"
                    elif history_fault == "redirect-generation":
                        case.local.generation += 1
                    elif history_fault == "redirect-dispatch":
                        cast(NativeDispatch, case.rows[NativeDispatch][0]).state = "unknown"
                    elif history_fault == "redirect-cancelled":
                        cast(NativeTestScope, case.rows[NativeTestScope][0]).cancelled = True
                    elif history_fault == "redirect-ambiguous":
                        raise RuntimeError("seal_commit_ack_lost")
                    elif history_fault == "redirect-unacknowledged":
                        return object()
                    elif history_fault == "redirect-checkpoint":
                        cast(NativeContinuation, case.rows[NativeContinuation][0]).payload_digest = "d" * 64
                    elif history_fault == "redirect-run":
                        runtime.host.lifetime.context.__dict__["native_run_id"] = "foreign-run"
                    return result
                except BaseException as error:
                    seal_errors.append(error)
                    raise

            monkeypatch.setattr(lifecycle, "seal_stop", checked_seal)

        def pause(**kw: Unpack[PauseValues]) -> WaitingReceipt:
            return WaitingReceipt(
                request_id=context.ref.request_id,
                invocation_id=context.ref.invocation_id,
                generation=generation,
                checkpoint=kw["checkpoint"],
                pending_operation_ids=kw["pending_operation_ids"],
                wait_reason="approval",
            )

        monkeypatch.setattr(lifecycle, "pause", pause)
        runtime = DifyNativeRuntime(
            delivery=NativeDispatchRef(context.ref, generation, f"delivery-{generation}"),
            lifecycle=lifecycle,
            registry=registry,
        )
        case.rows[NativeDispatch] = [
            NativeDispatch(
                idempotency_digest="a" * 64,
                id=f"delivery-{generation}",
                request_id=context.ref.request_id,
                invocation_id=context.ref.invocation_id,
                tenant_id=context.tenant_id,
                generation=generation,
                state="claimed",
                checkpoint_id=checkpoint_ref.checkpoint_id if generation else None,
            )
        ]
        if history_fault is not None and (history_fault.startswith("redirect") or history_fault == "initial-stop"):
            from models.dify_builder_native_tests import NativeContinuation, NativePayloadObject

            case.local.checkpoint_id = checkpoint_ref.checkpoint_id if generation else None
            if generation:
                case.rows[NativeContinuation] = [
                    NativeContinuation(
                        request_id=context.ref.request_id,
                        invocation_id=context.ref.invocation_id,
                        tenant_id=context.tenant_id,
                        checkpoint_id=checkpoint_ref.checkpoint_id,
                        payload_digest=checkpoint_ref.payload_digest,
                        generation=0,
                        payload_ref="checkpoint-object",
                    )
                ]
                case.rows[NativePayloadObject].append(
                    NativePayloadObject(
                        value_digest="b" * 64,
                        id=checkpoint_ref.checkpoint_id,
                        request_id=context.ref.request_id,
                        invocation_id=context.ref.invocation_id,
                        tenant_id=context.tenant_id,
                        kind="checkpoint",
                        logical_key="0",
                        payload_digest=checkpoint_ref.payload_digest,
                        storage_key="checkpoint-object",
                    )
                )

        def cleanup(**kw: Unpack[CleanupIdentity]) -> None:
            runtime.host.lifetime.consume_cleanup(**kw)

        monkeypatch.setattr(runtime.capacity, "record_cleanup", cleanup)
        monkeypatch.setattr(lifecycle, "claimed_resume_checkpoint", lambda **_kw: checkpoint_ref)
        # Only durable cancellation-fence selection is replaced in this unit.
        monkeypatch.setattr(runtime.host._cancellation_fence, "poll", lambda: False)
        return runtime

    application = Flask(__name__)
    application.config["SQLALCHEMY_DATABASE_URI"] = "sqlite://"
    database.init_app(application)
    with application.app_context():
        initial = prepare(0)
        waiting = initial.run_initial(context=context)
        if history_fault == "initial-stop":
            from models.dify_builder_native_tests import NativeTestInvocation

            assert waiting.status == "stopped"
            assert waiting.reason_code == "effect_denied"
            assert case.request.state == "sealed"
            assert not cast(NativeTestInvocation, case.rows[NativeTestInvocation][0]).active
            assert initial.host.lifetime._consumed
            assert cast(WorkflowRun, case.rows[WorkflowRun][0]).status == "stopped"
            assert sends == []
            assert thread_errors == []
            return
        assert waiting.status == "waiting"
        assert sends == []
        payload = checkpoints["payload"]
        assert len(payload.node_journals) == len(payload.approval_proposals)
        assert 1 <= len(payload.node_journals) <= (2 if kind == "iteration" else 1)
        assert all(journal.intents for journal in payload.node_journals)
        assert cast(WorkflowRun, case.rows[WorkflowRun][0]).status == "paused"
        original_started = cast(WorkflowRun, case.rows[WorkflowRun][0]).created_at
        assert initial.host.lifetime._consumed
        case.local.generation = 1
        case.context = case.store.load_context(ref=context.ref)
        context = case.context
        # Current C02 decision boundary now permits the exact restored key;
        # SQL confirmation itself is exercised only in the CI-only witness.
        auth.decisions.clear()
        resumed = prepare(1)
        if history_fault in ("missing", "foreign"):
            if history_fault == "missing":
                case.rows[WorkflowRun].clear()
            else:
                cast(WorkflowRun, case.rows[WorkflowRun][0]).app_id = "foreign-app"
            with pytest.raises(NativeObservationError, match="native_observation_failed"):
                resumed.resume(context=context, checkpoint=checkpoints["payload"], resolutions=())
            assert sends == []
            assert resumed.host.lifetime.unknown
            assert resumed.host._worker is None
            return
        result = resumed.resume(context=context, checkpoint=checkpoints["payload"], resolutions=())
        if history_fault is not None and history_fault.startswith("price-"):
            assert result.status == "unknown"
            assert resumed.host.lifetime.unknown
            assert not resumed.host.lifetime._consumed
            for tracked in resumed.host.lifetime._threads:
                tracked.thread.join(2)
                assert not tracked.thread.is_alive()
            assert all(type(error) is NativeObservationError for error in thread_errors)
            resumed.host.release_dead_dispatcher_logs()
            return
        if history_fault is not None and (history_fault.startswith("redirect") or history_fault == "initial-stop"):
            from models.dify_builder_native_tests import NativeTestInvocation
            from runtime_contracts.builder.execution import BuilderExecutionPolicyError

            for thread in transition_threads:
                thread.join(2)
                assert not thread.is_alive()
            if history_fault not in ("redirect", "redirect-transition"):
                assert result.status == "unknown"
                assert resumed.host.lifetime.unknown
                assert not resumed.host.lifetime._consumed
                assert len(sends) == 1
                for tracked in resumed.host.lifetime._threads:
                    tracked.thread.join(2)
                    assert not tracked.thread.is_alive()
                resumed.host.release_dead_dispatcher_logs()
                return
            assert not seal_errors, seal_errors
            assert not transition_errors, transition_errors
            assert len(sends) == 1, (result, resumed.host.boundary_owner.status)
            assert case.request.state == "sealed", (result, resumed.host.boundary_owner.records)
            assert not cast(NativeTestInvocation, case.rows[NativeTestInvocation][0]).active
            with pytest.raises(BuilderExecutionPolicyError, match="native_invocation_mismatch"):
                case.store.load_context(ref=context.ref)
            assert result.status == "stopped"
            assert result.reason_code == "native_http_redirect_limit"

            assert not resumed.host.lifetime.unknown
            assert resumed.host.lifetime._consumed
            assert len(sends) == 1
            assert cast(WorkflowRun, case.rows[WorkflowRun][0]).status == "stopped"
            assert thread_errors == []
            return
        assert result.status == "completed"
        assert result.native_status == "succeeded"
        assert thread_errors == []
        assert result.native_run_id == waiting.native_run_id
        assert len(sends) == (2 if kind == "iteration" else 1)
        assert len(case.rows[WorkflowRun]) == 1
        assert cast(WorkflowRun, case.rows[WorkflowRun][0]).created_at == original_started
        assert cast(WorkflowRun, case.rows[WorkflowRun][0]).status == "succeeded"
        if kind != "root":
            from models.workflow import WorkflowNodeExecutionModel

            assert checked_live_phase
            assert normalized
            rows = cast(list[WorkflowNodeExecutionModel], case.rows[WorkflowNodeExecutionModel])
            assert any(row.node_id == "http" and row.execution_metadata_dict.get(kind + "_id") for row in rows)


def install_owner_join_boundary(case: ObservationOwnerCase, monkeypatch: pytest.MonkeyPatch) -> None:
    context = case.context
    from models.dify_builder import DifyBuilderSession, DifyBuilderTestInput
    from models.model import App
    from models.workflow import Workflow
    from tests.unit_tests.services.dify_builder.native_testing.test_host_capacity import SQL

    ordinary_scalar = SQL.scalar

    def scoped_owner_join[T](sql: SQL, query: Select[tuple[T]]) -> T | str | None:
        if query.column_descriptions[0]["entity"] is DifyBuilderSession and query._setup_joins:
            # This SQL boundary double does not implement joins. Check every
            # modeled joined owner before returning its selected session ID.
            builder = cast(DifyBuilderSession, case.rows[DifyBuilderSession][0])
            app, workflow = cast(App, case.rows[App][0]), cast(Workflow, case.rows[Workflow][0])
            inputs = cast(DifyBuilderTestInput, case.rows[DifyBuilderTestInput][0])
            assert (builder.id, builder.tenant_id, builder.owner_account_id, builder.app_id) == (
                case.request.session_id,
                context.tenant_id,
                context.actor_id,
                context.app_id,
            )
            assert (app.id, app.tenant_id, workflow.id, workflow.app_id, workflow.tenant_id) == (
                context.app_id,
                context.tenant_id,
                context.workflow_id,
                context.app_id,
                context.tenant_id,
            )
            assert (inputs.id, inputs.session_id) == (case.request.test_input_id, builder.id)
            return builder.id
        return ordinary_scalar(sql, query)

    monkeypatch.setattr(SQL, "scalar", scoped_owner_join)


def test_actual_inactive_retained_delivery_and_missing_cancel_handles_grant_no_cleanup(
    case: ObservationOwnerCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    from services.dify_builder.native_testing.lifecycle import NativeDispatchRef
    from services.dify_builder.native_testing.runtime import DifyNativeRuntimeOwner
    from tests.unit_tests.services.dify_builder.native_testing.test_native_observation_wiring import protect_logs

    protect_logs(monkeypatch)
    context = case.context
    case.rows[NativeDispatch] = [
        NativeDispatch(
            idempotency_digest="a" * 64,
            id="inactive",
            tenant_id=context.tenant_id,
            request_id=context.ref.request_id,
            invocation_id=context.ref.invocation_id,
            generation=0,
            state="queued",
        )
    ]
    install_owner_join_boundary(case, monkeypatch)
    owner = DifyNativeRuntimeOwner()
    lifecycle = owner.delivery(
        sessions=case.loader.session_factory, delivery=NativeDispatchRef(context.ref, 0, "inactive")
    )
    from services.dify_builder.native_testing.runtime import DifyNativeRuntime

    assert isinstance(lifecycle.runtime, DifyNativeRuntime)
    host = lifecycle.runtime.host
    assert owner.cancel(refs=(context.ref,)) == ()
    assert host.lifetime._registry is None
    assert not host.lifetime._consumed
    assert lifecycle._capacity is not None
    assert not lifecycle._capacity._used
    with pytest.raises(ValueError, match="native_host_acquisition_not_current"):
        host.lifetime.consume_cleanup(ref=context.ref, generation=0, dispatch_id="inactive")
    assert owner.cancel(refs=(context.ref.model_copy(update={"invocation_id": "foreign"}),)) == ()
    assert owner.recovery_evidence(context=context, dispatch_id="inactive") == "unknown"


def test_actual_activated_startup_failure_consumes_only_original_zero_activity_verifier(
    case: ObservationOwnerCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from services.dify_builder.native_testing.host_lifetime import NativeHostLifetimeRegistry
    from services.dify_builder.native_testing.lifecycle import NativeDispatchRef
    from services.dify_builder.native_testing.runtime import DifyNativeResumeSettlement, DifyNativeRuntime
    from tests.unit_tests.services.dify_builder.native_testing.test_native_observation_wiring import protect_logs

    protect_logs(monkeypatch)
    context = case.context
    lifecycle = NativeTestLifecycleService(
        case.loader, state_store=case.store, resume_settlement=DifyNativeResumeSettlement()
    )
    runtime = DifyNativeRuntime(
        delivery=NativeDispatchRef(context.ref, 0, "start-failed"),
        lifecycle=lifecycle,
        registry=NativeHostLifetimeRegistry(),
    )
    case.rows[NativeDispatch] = [
        NativeDispatch(
            idempotency_digest="a" * 64,
            id="start-failed",
            tenant_id=context.tenant_id,
            request_id=context.ref.request_id,
            invocation_id=context.ref.invocation_id,
            generation=0,
            state="claimed",
        )
    ]
    receipts: list[dict[str, object]] = []

    def cleanup(**identity: Unpack[CleanupIdentity]) -> None:
        # Only the SQL ACK is doubled; actual original zero-activity proof is consumed.
        runtime.capacity._verifier.consume_cleanup(**identity)
        receipts.append(dict(identity))

    def unavailable(**kwargs: object) -> NoReturn:
        del kwargs
        raise BuilderExecutionPolicyError("native_capability_unavailable")

    monkeypatch.setattr(runtime.capacity, "record_cleanup", cleanup)
    monkeypatch.setattr("services.dify_builder.native_testing.runtime.build_delivery_bridge", unavailable)
    with pytest.raises(BuilderExecutionPolicyError, match="native_capability_unavailable"):
        runtime.run_initial(context=context)
    assert runtime.host.lifetime._consumed
    assert len(receipts) == 1
    assert runtime.host.lifetime._threads == []
    assert runtime.host.lifetime._node_scopes == []


def test_same_worker_reclaims_over_128_closed_consumed_requests_but_keeps_unknown_live(
    case: ObservationOwnerCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Actual owner/runtime/registry/verifiers; SQL/claim/object ACK boundaries only."""
    from copy import deepcopy
    from threading import Event, Thread, current_thread

    from models.dify_builder import DifyBuilderExecutionRequest
    from models.dify_builder_native_tests import (
        NativeInvocationState,
        NativePayloadObject,
        NativeTestInvocation,
        NativeTestScope,
    )
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError, canonical_digest
    from runtime_contracts.builder.native.contracts import NativeTestContextRef
    from services.dify_builder.native_testing import runtime as runtime_module
    from services.dify_builder.native_testing.lifecycle import NativeDispatchRef
    from tests.unit_tests.services.dify_builder.native_testing.test_native_observation_wiring import protect_logs

    protect_logs(monkeypatch)
    install_owner_join_boundary(case, monkeypatch)
    owner = runtime_module.DifyNativeRuntimeOwner()
    original_read = NativeExecutionStateStore._read_object
    original_bridge = runtime_module.build_delivery_bridge
    objects: dict[str, dict[str, object]] = {}

    def protected_read(row: NativePayloadObject | ObjectReceipt) -> dict[str, object]:
        original_read(
            cast(NativePayloadObject, case.rows[NativePayloadObject][0])
        )  # Preserve fixture's outside-SQL assertion.
        return deepcopy(objects[row.id]) if row.id in objects else case.context.model_dump(mode="json")

    monkeypatch.setattr(NativeExecutionStateStore, "_read_object", staticmethod(protected_read))

    def bridge(*, runtime: DifyNativeRuntime) -> NativeRuntimeBridge:
        if runtime.context.ref.request_id == "retained-live":
            return original_bridge(runtime=runtime)
        raise BuilderExecutionPolicyError("native_capability_unavailable")

    monkeypatch.setattr(runtime_module, "build_delivery_bridge", bridge)

    def acquisition(identity: str) -> tuple[DifyNativeRuntime, DifyBuilderExecutionRequest]:
        stored = {**case.request.context, "request_id": identity, "native_run_id": "run-" + identity}
        ref = NativeTestContextRef(
            request_id=identity, invocation_id=case.context.ref.invocation_id, context_digest=canonical_digest(stored)
        )
        context = case.context.model_copy(
            update={
                "ref": ref,
                "native_run_id": "run-" + identity,
                "root_native_run_id": "run-" + identity,
                "budget_ref": identity,
                "cancellation_ref": identity,
            },
            deep=True,
        )
        request = deepcopy(case.request)
        request.id, request.context, request.context_digest = identity, stored, ref.context_digest
        case.rows[DifyBuilderExecutionRequest].append(request)
        for model in (NativeInvocationState, NativePayloadObject, NativeTestInvocation, NativeTestScope):
            row = deepcopy(case.rows[model][0])
            assert isinstance(row, (NativeInvocationState, NativePayloadObject, NativeTestInvocation, NativeTestScope))
            row.request_id = identity
            if isinstance(row, NativeInvocationState):
                row.id, row.context_object_id = "state-" + identity, "context-" + identity
            if isinstance(row, NativePayloadObject):
                row.id = "context-" + identity
                objects[row.id] = context.model_dump(mode="json")
            case.rows[model].append(row)
        dispatch = NativeDispatch(
            idempotency_digest="a" * 64,
            id="delivery-" + identity,
            request_id=identity,
            invocation_id=ref.invocation_id,
            tenant_id=context.tenant_id,
            generation=0,
            state="queued",
        )
        case.rows.setdefault(NativeDispatch, []).append(dispatch)
        lifecycle = owner.delivery(
            sessions=case.loader.session_factory, delivery=NativeDispatchRef(ref, 0, dispatch.id)
        )
        runtime = lifecycle.runtime
        assert isinstance(runtime, runtime_module.DifyNativeRuntime)
        dispatch.state = "claimed"  # Explicit SQL claim ACK boundary.

        def cleanup(**actual: Unpack[CleanupIdentity]) -> None:
            runtime.capacity._verifier.consume_cleanup(**actual)

        monkeypatch.setattr(runtime.capacity, "record_cleanup", cleanup)
        return runtime, request

    live, live_request = acquisition("retained-live")
    live._start(live.context)  # Actual claimed-row selection and registry activation.
    entered, release = Event(), Event()

    def background() -> None:
        entered.set()
        try:
            # The live-thread witness belongs to the test's finally release,
            # including when the 130 real acquisitions run slowly under CI.
            assert release.wait()
        finally:
            live.host.lifetime.thread_finished(thread=current_thread())

    worker = Thread(target=background)
    live.host.lifetime.register_thread(thread=worker, role="worker")
    live.host.lifetime.start_thread(thread=worker)
    try:
        assert entered.wait(2)
        live.host.mark_unknown()
        live_request.state = "sealed"  # Even durable closure cannot substitute for physical cleanup.
        for index in range(130):
            runtime, request = acquisition("closed-" + str(index))
            with pytest.raises(BuilderExecutionPolicyError, match="native_capability_unavailable"):
                runtime.run_initial(context=runtime.context)
            assert runtime.host.lifetime._consumed
            request.state = "sealed"  # Durable finalization boundary, after actual zero-activity consumption.
        from tests.unit_tests.services.dify_builder.native_testing.test_host_capacity import SQL

        actual_scalar, last_closed = SQL.scalar, request
        reentered: list[bool] = []

        def retire_during_read[T](sql: SQL, query: Select[tuple[T]]) -> T | None:
            row = actual_scalar(sql, query)
            if row is last_closed and not reentered:
                reentered.append(True)
                owner.retire_closed(sessions=case.loader.session_factory)
            return row

        with monkeypatch.context() as racing:
            racing.setattr(SQL, "scalar", retire_during_read)
            owner.retire_closed(sessions=case.loader.session_factory)
        assert reentered == [True]
        assert runtime.registry._disposed
        waiting, waiting_request = acquisition("durable-waiting")
        with pytest.raises(BuilderExecutionPolicyError, match="native_capability_unavailable"):
            waiting.run_initial(context=waiting.context)
        assert waiting.host.lifetime._consumed
        waiting_request.state = "waiting"  # Open durable admission is never evicted by physical consumption.
        owner.retire_closed(sessions=case.loader.session_factory)
        assert len(owner._requests) == 2
        assert len(owner._current) == 2
        assert live in owner._current.values()
        assert waiting in owner._current.values()
        assert worker.is_alive()
        assert live.host.lifetime.unknown
        assert not live.host.lifetime._consumed
    finally:
        release.set()
        worker.join(2)
    assert not worker.is_alive()


@pytest.fixture
def cancel_composition(case: ObservationOwnerCase, monkeypatch: pytest.MonkeyPatch) -> CancellationCase:
    """Real API/compiler/C03/runtime owners; mutable SQL and protected bytes are boundaries."""
    from copy import deepcopy
    from uuid import uuid4

    from core.dify_builder.input_schema import schema_hash, start_schema
    from core.dify_builder.models import Actor
    from models.dify_builder import DifyBuilderSession, DifyBuilderSessionCommit, DifyBuilderTestInput
    from models.model import App
    from models.workflow import Workflow
    from services.dify_builder.native_testing import api_service, host_capacity, repository
    from services.dify_builder.native_testing import state_store as state_module
    from services.dify_builder.native_testing.runtime import DifyNativeRuntimeOwner, build_native_api
    from tests.unit_tests.services.dify_builder.native_testing.test_host_capacity import SQL, Rows
    from tests.unit_tests.services.dify_builder.native_testing.test_native_observation_wiring import protect_logs

    protect_logs(monkeypatch)
    # This composition owns mutable SQL boundaries, not SQLAlchemy events.
    # Dedicated SQLite native-live-stream tests retain the real notification
    # transaction and prove commit/rollback behavior without this double.
    for module in (api_service, host_capacity, repository):
        monkeypatch.setattr(module, "native_observation_transaction", lambda factory, **_: factory.begin())
    original = case.context
    workflow = Workflow(
        id=original.workflow_id,
        tenant_id=original.tenant_id,
        app_id=original.app_id,
        type="workflow",
        version="draft",
        kind="standard",
        graph=json.dumps(original.graph),
        _features="{}",
        _environment_variables="{}",
        _conversation_variables="{}",
        created_by=original.actor_id,
    )
    case.rows[Workflow] = [workflow]
    cast(App, case.rows[App][0]).mode = AppMode.WORKFLOW
    builder = cast(DifyBuilderSession, case.rows[DifyBuilderSession][0])
    builder.version = 1
    builder.current_state = "build.review"
    cast(DifyBuilderTestInput, case.rows[DifyBuilderTestInput][0]).start_schema_hash = schema_hash(
        start_schema(dict(workflow.graph_dict), "workflow")
    )
    case.rows[DifyBuilderSessionCommit] = [
        DifyBuilderSessionCommit(
            id=str(uuid4()),
            session_id=builder.id,
            version=builder.version,
            state=builder.current_state,
            actor="user",
            context={"test_input_ref": cast(DifyBuilderTestInput, case.rows[DifyBuilderTestInput][0]).id},
        )
    ]
    for model in tuple(case.rows):
        if model.__module__ == "models.dify_builder_native_tests" or model.__name__ == "DifyBuilderExecutionRequest":
            case.rows[model] = []
    depth = _SqlDepth()

    class MutableSQL(SQL):
        @override
        def get[T](self, model: type[T], identity: object) -> T | None:
            assert issubclass(model, (Base, TypeBase))
            key = next(iter(inspect(model).primary_key)).key
            if key == "id":
                return cast(
                    T | None,
                    next(
                        (
                            row
                            for row in self.rows.get(model, [])
                            if inspect(row, raiseerr=True).attrs["id"].value == identity
                        ),
                        None,
                    ),
                )
            if key == "request_id":
                return cast(
                    T | None,
                    next(
                        (
                            row
                            for row in self.rows.get(model, [])
                            if inspect(row, raiseerr=True).attrs["request_id"].value == identity
                        ),
                        None,
                    ),
                )
            raise AssertionError("unsupported SQL primary key")

        @override
        def add(self, row: object) -> None:
            assert isinstance(row, (Base, TypeBase))
            for column in inspect(type(row)).columns:
                if inspect(row, raiseerr=True).attrs[column.key].value is None and column.default is not None:
                    assert isinstance(column.default, ColumnDefault)
                    value = column.default.arg
                    setattr(row, column.key, value(None) if callable(value) else deepcopy(value))
            self.rows.setdefault(type(row), []).append(row)

        @override
        def flush(self) -> None:
            pass

        @override
        def execute[T: tuple[object, ...]](self, _query: Select[T]) -> Rows[T]:
            query = _query
            # Reconcile's expired-claim query returns tuples. No claim in this
            # boundary is expired; cancellation scans still use actual scalars.
            if len(query.column_descriptions) > 1:
                from models.dify_builder import DifyBuilderExecutionRequest
                from services.dify_builder.native_testing.repository import utc_now

                dispatches = list(self.scalars(cast(Select[tuple[NativeDispatch]], query)))
                expiring = any(
                    isinstance(clause, BinaryExpression)
                    and isinstance(clause.left, ColumnClause)
                    and clause.left.key == "claim_expires_at"
                    for clause in query._where_criteria
                    if isinstance(clause, BinaryExpression)
                )
                if expiring:
                    dispatches = [
                        row
                        for row in dispatches
                        if row.claim_expires_at is not None and row.claim_expires_at <= utc_now()
                    ]
                result = Rows()
                for row in dispatches:
                    request = self.get(DifyBuilderExecutionRequest, row.request_id)
                    assert request is not None
                    result.append((row, request.context_digest))
                return cast(Rows[T], result)
            return super().execute(query)

    sql = MutableSQL(case.rows, [])

    class Sessions:
        @contextmanager
        def __call__(self) -> Generator[MutableSQL]:
            yield sql

        @contextmanager
        def begin(self) -> Generator[MutableSQL]:
            depth.writers = depth.writers + 1
            try:
                yield sql
            finally:
                depth.writers -= 1

    sessions = Sessions()
    actor = Actor(account_id=original.actor_id, tenant_id=original.tenant_id)

    def permission(actual: Actor, app_id: str, source: object) -> None:
        assert not depth.writers
        assert (actual, app_id, source) == (actor, original.app_id, sessions)

    for path in (
        "services.dify_builder.execution_policy_service.check_execution_permission",
        "services.dify_builder.native_testing.private_reads.check_execution_permission",
        "services.dify_builder.native_testing.http_binding.check_execution_permission",
        "services.dify_builder.native_testing.api_service.check_execution_permission",
        "services.dify_builder.native_testing.context_binding.check_execution_permission",
    ):
        monkeypatch.setattr(path, permission)
    objects: dict[str, str] = {}

    def prepare(
        store: NativeExecutionStateStore,
        *,
        ref: NativeTestContextRef,
        tenant_id: str,
        kind: str,
        logical_key: str,
        payload: JsonValue,
    ) -> ObjectReceipt:
        del store
        assert not depth.writers
        raw, digest = state_module.encode_payload(
            tenant_id=tenant_id, request_id=ref.request_id, invocation_id=ref.invocation_id, kind=kind, payload=payload
        )
        identity = str(uuid4())
        objects[identity] = raw
        return state_module.ObjectReceipt(
            identity,
            tenant_id,
            ref.request_id,
            ref.invocation_id,
            kind,
            logical_key,
            identity,
            digest,
            state_module.canonical_digest(payload),
        )

    def read(row: NativePayloadObject | ObjectReceipt) -> JsonValue:
        assert not depth.writers
        return state_module.decode_payload(
            objects[row.id],
            tenant_id=row.tenant_id,
            request_id=row.request_id,
            invocation_id=row.invocation_id,
            kind=row.kind,
            digest=row.payload_digest,
        )

    monkeypatch.setattr(NativeExecutionStateStore, "prepare_object", prepare)
    monkeypatch.setattr(NativeExecutionStateStore, "_read_object", staticmethod(read))
    # Model the actual fully scoped joined owner selection, which SQL's simple
    # single-table fixture cannot evaluate across owner-table columns.
    scalar = MutableSQL.scalar

    def joined[T](sql: MutableSQL, query: Select[tuple[T]]) -> T | str | None:
        if query.column_descriptions[0]["entity"] is DifyBuilderSession and query._setup_joins:
            builder = cast(DifyBuilderSession, case.rows[DifyBuilderSession][0])
            assert (builder.tenant_id, builder.owner_account_id, builder.app_id) == (
                actor.tenant_id,
                actor.account_id,
                original.app_id,
            )
            assert workflow.app_id == builder.app_id
            return builder.id
        return scalar(sql, query)

    monkeypatch.setattr(MutableSQL, "scalar", joined)
    owner = DifyNativeRuntimeOwner()
    published: list[dict[str, JsonValue]] = []
    api = build_native_api(sessions=sessions, actor=actor, owner=owner, publish=lambda **msg: published.append(msg))
    started = api.start(
        actor=actor,
        session_id="session",
        test_input_id="input",
        expected_version=1,
        mode="native",
        idempotency_key="cancel-composed-start",
    )
    return CancellationCase(
        api=api,
        owner=owner,
        published=published,
        sql=sql,
        sessions=sessions,
        actor=actor,
        started=started,
        rows=case.rows,
    )


def test_composed_start_cancel_before_delivery_reconciles_without_physical_acquisition(
    cancel_composition: CancellationCase,
) -> None:
    from models.dify_builder_native_tests import NativeInvocationState
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from runtime_contracts.builder.native.contracts import decode_native_ref
    from services.dify_builder.native_testing.lifecycle import NativeDispatchRef

    c = cancel_composition
    assert len(c.published) == 1
    assert c.owner._requests == c.owner._current == {}
    result = c.api.cancel(
        actor=c.actor, session_id="session", request_id=c.started.request_id, idempotency_key="cancel"
    )
    assert result.cancellation is not None
    assert result.cancellation.status == "cancelled"
    assert result.status == "terminal"
    assert cast(NativeInvocationState, c.rows[NativeInvocationState][0]).cleanup_complete
    assert cast(NativeDispatch, c.rows[NativeDispatch][0]).state == "cancelled"
    assert c.api.lifecycle.reconcile() == 0
    message = c.published[0]
    ref = decode_native_ref(message["ref"])
    late = c.owner.delivery(sessions=c.sessions, delivery=NativeDispatchRef(ref, 0, dispatch_identity(message)))
    with pytest.raises(BuilderExecutionPolicyError, match="native_cancelled"):
        late.execute_dispatch(ref=ref, generation=0, dispatch_id=dispatch_identity(message))
    assert c.owner._requests == c.owner._current == {}
    refreshed = c.api.get(actor=c.actor, session_id="session", request_id=c.started.request_id)
    assert refreshed.cancellation is not None
    assert refreshed.cancellation.status == "cancelled"


def test_consumed_generation_zero_in_other_owner_cannot_ack_live_generation_one(
    cancel_composition: CancellationCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Real two retained owners and worker; SQL claim/resume publication are explicit boundaries."""
    from threading import Event, Thread, current_thread

    from models.dify_builder_native_tests import NativeInvocationState, NativeTestScope
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from runtime_contracts.builder.native.contracts import decode_native_ref
    from services.dify_builder.native_testing import runtime as module
    from services.dify_builder.native_testing.lifecycle import NativeDispatchRef

    c = cancel_composition
    message = c.published[0]
    ref = decode_native_ref(message["ref"])
    from tests.unit_tests.services.dify_builder.native_testing.test_native_observation_wiring import protect_logs

    protect_logs(monkeypatch)
    source = c.owner.delivery(sessions=c.sessions, delivery=NativeDispatchRef(ref, 0, dispatch_identity(message)))
    old = source.runtime
    assert isinstance(old, module.DifyNativeRuntime)
    dispatch = cast(NativeDispatch, c.rows[NativeDispatch][0])
    assert isinstance(dispatch, NativeDispatch)
    dispatch.state = "claimed"  # SQL claim ACK boundary, before actual activation.

    def unavailable(**kwargs: object) -> NoReturn:
        del kwargs
        raise BuilderExecutionPolicyError("native_capability_unavailable")

    with monkeypatch.context() as broken:
        broken.setattr(module, "build_delivery_bridge", unavailable)
        with pytest.raises(BuilderExecutionPolicyError, match="native_capability_unavailable"):
            old.run_initial(context=old.context)
    assert old.host.lifetime._consumed
    dispatch.state = "completed"
    state = cast(NativeInvocationState, c.rows[NativeInvocationState][0])
    state.generation, state.cleanup_complete = 1, False
    cast(NativeTestScope, c.rows[NativeTestScope][0]).generation = 1
    resumed = NativeDispatch(
        id="resumed-delivery",
        request_id=ref.request_id,
        tenant_id=c.actor.tenant_id,
        invocation_id=ref.invocation_id,
        generation=1,
        state="queued",
        idempotency_digest="resume-sql-boundary",
    )
    c.sql.add(resumed)
    other = module.DifyNativeRuntimeOwner()
    current = other.delivery(sessions=c.sessions, delivery=NativeDispatchRef(ref, 1, resumed.id)).runtime
    assert isinstance(current, module.DifyNativeRuntime)
    resumed.state = "claimed"  # C03 resume/claim boundary; not a checkpoint durability witness.
    current._start(current.context)
    entered, release = Event(), Event()

    def work() -> None:
        entered.set()
        try:
            assert release.wait(10)
        finally:
            current.host.lifetime.thread_finished(thread=current_thread())

    worker = Thread(target=work)
    current.host.lifetime.register_thread(thread=worker, role="worker")
    current.host.lifetime.start_thread(thread=worker)
    try:
        assert entered.wait(2)
        result = c.api.cancel(
            actor=c.actor, session_id="session", request_id=c.started.request_id, idempotency_key="cancel-live"
        )
        assert result.cancellation is not None
        assert result.cancellation.status == "cancelling"
        assert not state.cleanup_complete
        assert c.api.lifecycle.reconcile() == 1
        assert not state.cleanup_complete
        assert worker.is_alive()
        assert not current.host.lifetime._consumed
        assert old.host.lifetime._consumed
    finally:
        release.set()
        worker.join(3)
    assert not worker.is_alive()


@pytest.mark.parametrize("replace_after_settlement", [False, True])
def test_cancel_original_joined_owner_rechecks_retained_snapshot(
    cancel_composition: CancellationCase, monkeypatch: pytest.MonkeyPatch, replace_after_settlement: bool
) -> None:
    from threading import Thread, current_thread

    from models.dify_builder_native_tests import NativeInvocationState
    from runtime_contracts.builder.native.contracts import decode_native_ref
    from services.dify_builder.native_testing import runtime as module
    from services.dify_builder.native_testing.lifecycle import NativeDispatchRef
    from tests.unit_tests.services.dify_builder.native_testing.test_native_observation_wiring import protect_logs

    protect_logs(monkeypatch)
    c = cancel_composition
    message = c.published[0]
    ref = decode_native_ref(message["ref"])
    delivery = NativeDispatchRef(ref, 0, dispatch_identity(message))
    runtime = c.owner.delivery(sessions=c.sessions, delivery=delivery).runtime
    replacement = module.DifyNativeRuntimeOwner().delivery(sessions=c.sessions, delivery=delivery).runtime
    assert isinstance(runtime, module.DifyNativeRuntime)
    assert isinstance(replacement, module.DifyNativeRuntime)
    cast(NativeDispatch, c.rows[NativeDispatch][0]).state = "claimed"  # SQL claim boundary.
    runtime._start(runtime.context)
    worker = Thread(target=lambda: runtime.host.lifetime.thread_finished(thread=current_thread()))
    runtime.host.lifetime.register_thread(thread=worker, role="worker")
    runtime.host.lifetime.start_thread(thread=worker)
    worker.join(2)
    assert not worker.is_alive()
    actual_settle = runtime.host.lifetime.settle

    def settle() -> Literal["settled", "unknown"]:
        result = actual_settle()
        if replace_after_settlement:
            # Race at the actual unlocked physical settlement boundary. Both
            # candidates are real acquisitions with the same delivery IDs.
            identity = next(iter(c.owner._current))
            with c.owner._lock:
                c.owner._current[identity] = replacement
        return result

    monkeypatch.setattr(runtime.host.lifetime, "settle", settle)
    result = c.api.cancel(
        actor=c.actor, session_id="session", request_id=c.started.request_id, idempotency_key="cancel-joined"
    )
    # Cleanup ACK retains its original assertion below; the source is still claimed,
    # so truthful cancellation now waits for source finalization in both races.
    assert result.cancellation is not None
    assert result.cancellation.status == "cancelling"
    assert cast(NativeInvocationState, c.rows[NativeInvocationState][0]).cleanup_complete is (
        not replace_after_settlement
    )
    assert runtime.host.lifetime._consumed is (not replace_after_settlement)
    assert not replacement.host.lifetime._consumed


@pytest.mark.parametrize("history", ["missing-outbox", "prior-lease", "foreign-outbox", "missing-context", "resumed"])
def test_composed_cancel_does_not_upgrade_incomplete_or_noninitial_history(
    cancel_composition: CancellationCase, history: str
) -> None:
    from models.dify_builder_native_tests import (
        NativeInvocationState,
        NativePayloadObject,
        NativeTestScope,
    )
    from services.dify_builder.native_testing.repository import utc_now

    c = cancel_composition
    dispatch, state = (
        cast(NativeDispatch, c.rows[NativeDispatch][0]),
        cast(NativeInvocationState, c.rows[NativeInvocationState][0]),
    )
    if history == "missing-outbox":
        c.rows[NativeDispatch].clear()
    elif history == "prior-lease":
        dispatch.claim_expires_at = utc_now()
    elif history == "foreign-outbox":
        dispatch.tenant_id = "foreign-tenant"
    elif history == "missing-context":
        c.rows[NativePayloadObject].clear()
    elif history == "resumed":
        state.generation = cast(NativeTestScope, c.rows[NativeTestScope][0]).generation = dispatch.generation = 1
    result = c.api.cancel(
        actor=c.actor, session_id="session", request_id=c.started.request_id, idempotency_key="unsafe-history"
    )
    assert result.cancellation is not None
    assert result.cancellation.status == "cancelling"
    assert not state.cleanup_complete
    assert c.api.lifecycle.reconcile() == 1
    assert not state.cleanup_complete
    assert c.owner._requests == c.owner._current == {}


def test_delivered_unclaimed_cancel_retires_logically_without_consuming_lifetime(
    cancel_composition: CancellationCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from runtime_contracts.builder.native.contracts import decode_native_ref
    from services.dify_builder.native_testing.lifecycle import NativeDispatchRef
    from services.dify_builder.native_testing.runtime import DifyNativeRuntime
    from tests.unit_tests.services.dify_builder.native_testing.test_native_observation_wiring import protect_logs

    protect_logs(monkeypatch)
    c = cancel_composition
    message = c.published[0]
    ref = decode_native_ref(message["ref"])
    lifecycle = c.owner.delivery(sessions=c.sessions, delivery=NativeDispatchRef(ref, 0, dispatch_identity(message)))
    runtime = lifecycle.runtime
    assert isinstance(runtime, DifyNativeRuntime)
    assert runtime.host.lifetime._registry is None
    result = c.api.cancel(
        actor=c.actor, session_id="session", request_id=c.started.request_id, idempotency_key="preclaim"
    )
    assert result.cancellation is not None
    assert result.cancellation.status == "cancelled"
    with pytest.raises(BuilderExecutionPolicyError, match="native_cancelled"):
        lifecycle.execute_dispatch(ref=ref, generation=0, dispatch_id=dispatch_identity(message))
    assert c.api.lifecycle.reconcile() == 0
    c.owner.retire_closed(sessions=c.sessions)
    assert c.owner._requests == c.owner._current == {}
    assert runtime.registry._disposed
    assert runtime.host.lifetime._registry is None
    assert not runtime.host.lifetime._consumed
    with pytest.raises(ValueError, match="native_host_acquisition_not_current"):
        runtime.registry.activate(lifetime=runtime.host.lifetime)
    assert not runtime.host.lifetime._consumed


@pytest.mark.timeout(60)
def test_over_128_delivered_unclaimed_logical_cancellations_reclaim_same_worker_slots(
    cancel_composition: CancellationCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    from runtime_contracts.builder.native.contracts import decode_native_ref
    from services.dify_builder.native_testing.lifecycle import NativeDispatchRef
    from services.dify_builder.native_testing.runtime import DifyNativeRuntime
    from tests.unit_tests.services.dify_builder.native_testing.test_native_observation_wiring import protect_logs

    protect_logs(monkeypatch)
    c = cancel_composition
    prior = None
    for index in range(130):
        started = (
            c.started
            if index == 0
            else c.api.start(
                actor=c.actor,
                session_id="session",
                test_input_id="input",
                expected_version=1,
                mode="native",
                idempotency_key="unclaimed-" + str(index),
            )
        )
        message = c.published[-1]
        lifecycle = c.owner.delivery(
            sessions=c.sessions,
            delivery=NativeDispatchRef(decode_native_ref(message["ref"]), 0, dispatch_identity(message)),
        )
        runtime = lifecycle.runtime
        assert isinstance(runtime, DifyNativeRuntime)
        if prior is not None:
            assert prior.registry._disposed
            assert not prior.host.lifetime._consumed
        result = c.api.cancel(
            actor=c.actor,
            session_id="session",
            request_id=started.request_id,
            idempotency_key="logical-cancel-" + str(index),
        )
        assert result.cancellation is not None
        assert result.cancellation.status == "cancelled"
        assert not runtime.host.lifetime._consumed
        assert runtime.host.lifetime._registry is None
        assert len(c.owner._requests) == len(c.owner._current) == 1
        prior = runtime
    c.owner.retire_closed(sessions=c.sessions)
    assert c.owner._requests == c.owner._current == {}
    assert len(c.published) == 130


@pytest.mark.parametrize("race", ["entry-replaced", "registry-replaced", "activated", "missing-history", "resumed"])
def test_logical_preclaim_retirement_rechecks_proof_and_exact_retained_owners(
    cancel_composition: CancellationCase, monkeypatch: pytest.MonkeyPatch, race: str
) -> None:
    from threading import Event, Thread, current_thread

    from models.dify_builder_native_tests import NativeInvocationState, NativeTestScope
    from runtime_contracts.builder.native.contracts import decode_native_ref
    from services.dify_builder.native_testing import host_capacity
    from services.dify_builder.native_testing.lifecycle import NativeDispatchRef
    from services.dify_builder.native_testing.runtime import DifyNativeRuntime, DifyNativeRuntimeOwner
    from tests.unit_tests.services.dify_builder.native_testing.test_native_observation_wiring import protect_logs

    protect_logs(monkeypatch)
    c = cancel_composition
    message = c.published[0]
    delivery = NativeDispatchRef(decode_native_ref(message["ref"]), 0, dispatch_identity(message))
    runtime = c.owner.delivery(sessions=c.sessions, delivery=delivery).runtime
    replacement = DifyNativeRuntimeOwner().delivery(sessions=c.sessions, delivery=delivery).runtime
    assert isinstance(runtime, DifyNativeRuntime)
    assert isinstance(replacement, DifyNativeRuntime)
    result = c.api.cancel(
        actor=c.actor, session_id="session", request_id=c.started.request_id, idempotency_key="logical-race"
    )
    assert result.cancellation is not None
    assert result.cancellation.status == "cancelled"
    if race == "missing-history":
        c.rows[NativeDispatch].clear()
    elif race == "resumed":
        cast(NativeInvocationState, c.rows[NativeInvocationState][0]).generation = cast(
            NativeTestScope, c.rows[NativeTestScope][0]
        ).generation = 1
    actual_proof = host_capacity.finish_unacquired_cancellation
    entered, release = Event(), Event()
    worker = None

    def work() -> None:
        entered.set()
        try:
            assert release.wait(10)
        finally:
            runtime.host.lifetime.thread_finished(thread=current_thread())

    def proof(lifecycle: NativeTestLifecycleService, *, ref: NativeTestContextRef) -> bool:
        nonlocal worker
        result = actual_proof(lifecycle, ref=ref)
        if race == "activated":
            # Race the real physical handoff after unlocked SQL. Atomic registry
            # disposal must refuse even this conservative late activation.
            runtime.registry.activate(lifetime=runtime.host.lifetime)
            worker = Thread(target=work)
            runtime.host.lifetime.register_thread(thread=worker, role="worker")
            runtime.host.lifetime.start_thread(thread=worker)
            assert entered.wait(2)
            runtime.host.mark_unknown()
        elif race == "entry-replaced":
            identity = next(iter(c.owner._current))
            with c.owner._lock:
                c.owner._current[identity] = replacement
        elif race == "registry-replaced":
            key = next(iter(c.owner._requests))
            with c.owner._lock:
                c.owner._requests[key] = replacement.registry
        return result

    monkeypatch.setattr(host_capacity, "finish_unacquired_cancellation", proof)
    try:
        c.owner.retire_closed(sessions=c.sessions)
        assert len(c.owner._requests) == len(c.owner._current) == 1
        assert not runtime.registry._disposed
        assert not runtime.host.lifetime._consumed
        if worker is not None:
            assert worker.is_alive()
    finally:
        release.set()
        if worker is not None:
            worker.join(2)
    assert not replacement.host.lifetime._consumed


def _cancel_projection_post_wait(
    c: CancellationCase, dispatch_state: str
) -> tuple[NativeTestContextRef, ResolvedNativeTestContext, NativeInvocationState, NativeDispatch, WorkflowRun]:
    """Explicit post-WAIT SQL boundary; no physical or checkpoint attestation."""
    from datetime import datetime
    from uuid import uuid4

    from models.dify_builder import DifyBuilderExecutionRequest
    from models.dify_builder_native_tests import NativeInvocationState
    from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
    from models.workflow import WorkflowRun, WorkflowType
    from runtime_contracts.builder.native.contracts import decode_native_ref

    ref = decode_native_ref(c.published[0]["ref"])
    context = c.api.store.load_context(ref=ref)
    state = cast(NativeInvocationState, c.rows[NativeInvocationState][0])
    assert isinstance(state, NativeInvocationState)
    state.state, state.cleanup_complete = "waiting", True
    state.checkpoint_id = str(uuid4())
    state.pending_ids, state.wait_reason = [str(uuid4())], "approval"
    cast(DifyBuilderExecutionRequest, c.rows[DifyBuilderExecutionRequest][0]).state = "waiting"
    dispatch = cast(NativeDispatch, c.rows[NativeDispatch][0])
    assert isinstance(dispatch, NativeDispatch)
    dispatch.state = dispatch_state
    run = WorkflowRun(
        id=context.native_run_id,
        tenant_id=context.tenant_id,
        app_id=context.app_id,
        workflow_id=context.workflow_id,
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
        version="draft",
        graph="{}",
        inputs="null",
        outputs="null",
        status="paused",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=context.actor_id,
        created_at=datetime(2026, 10, 16),
        elapsed_time=0.0,
        total_tokens=0,
        total_steps=0,
        exceptions_count=0,
    )
    c.sql.add(run)
    return ref, context, state, dispatch, run


@pytest.mark.parametrize("source_owner", ["root", "child"])
@pytest.mark.parametrize(
    ("source_state", "cleaned", "expected"),
    [
        ("unknown", True, "unknown"),
        ("unknown", False, "unknown"),
        ("claimed", True, "cancelling"),
        ("claimed", False, "cancelling"),
        ("completed", True, "cancelled"),
        ("completed", False, "cancelling"),
    ],
)
def test_cancel_projection_includes_owned_sources(
    cancel_composition: CancellationCase, source_owner: str, source_state: str, cleaned: bool, expected: str
) -> None:
    """Omitting a child/source or treating physical ACK as finalization breaks this table."""
    from uuid import uuid4

    from models.dify_builder_native_tests import (
        NativeEffectOperation,
        NativeInvocationState,
        NativePayloadObject,
        NativeTestInvocation,
    )

    c = cancel_composition
    ref, context, root, source, run = _cancel_projection_post_wait(c, "completed")
    selected = root
    if source_owner == "child":
        child_id = str(uuid4())
        selected = NativeInvocationState(
            **{column.key: inspect(root).attrs[column.key].value for column in NativeInvocationState.__table__.columns}
        )
        selected.invocation_id, selected.parent_invocation_id = child_id, root.invocation_id
        payload = cast(NativePayloadObject, c.rows[NativePayloadObject][0])
        child_payload = NativePayloadObject(
            **{column.key: inspect(payload).attrs[column.key].value for column in NativePayloadObject.__table__.columns}
        )
        child_payload.id, child_payload.invocation_id = str(uuid4()), child_id
        selected.context_object_id = child_payload.id
        c.sql.add(child_payload)
        c.sql.add(selected)
        c.sql.add(
            NativeTestInvocation(
                tenant_id=context.tenant_id,
                request_id=ref.request_id,
                invocation_id=child_id,
                active=True,
                bindings={},
            )
        )
        source = NativeDispatch(
            **{column.key: inspect(source).attrs[column.key].value for column in NativeDispatch.__table__.columns}
        )
        source.id, source.invocation_id, source.idempotency_digest = str(uuid4()), child_id, "b" * 64
        c.sql.add(source)
    source.state, selected.cleanup_complete = source_state, cleaned
    direct = c.api.lifecycle.cancel(actor=c.actor, request_id=ref.request_id, idempotency_key="source-policy")
    assert direct.status == expected
    assert direct.operation_states == {}
    for public in (
        c.api.get(actor=c.actor, session_id="session", request_id=ref.request_id),
        c.api.cancel(actor=c.actor, session_id="session", request_id=ref.request_id, idempotency_key="source-repeat"),
    ):
        assert public.cancellation is not None
        assert public.cancellation.status == expected
        assert public.cancellation is not None
        assert public.cancellation.operation_states == {}
        assert public.outcome == (None if expected == "cancelling" else expected)
        assert public.status == ("running" if expected == "cancelling" else "terminal")
        assert public.native_run_id == run.id == context.native_run_id
        assert public.native_status == "paused"
        assert public.pending == ()
    assert selected.cleanup_complete is cleaned
    assert source.state == source_state
    assert source.generation == selected.generation == root.generation == 0
    assert len(c.published) == 1
    assert c.rows.get(NativeEffectOperation, []) == []


@pytest.mark.parametrize("changed_fact", ["effect", "claimed-effect", "source"])
def test_cancel_projection_reloads_after_outside_writer_cleanup(
    cancel_composition: CancellationCase, monkeypatch: pytest.MonkeyPatch, changed_fact: str
) -> None:
    """A pre-cleanup effect/source snapshot must never hide a later durable unknown."""
    from uuid import uuid4

    from models.dify_builder_native_tests import NativeEffectOperation

    c = cancel_composition
    ref, _, state, source, _ = _cancel_projection_post_wait(c, "claimed")
    state.cleanup_complete = False
    operation = NativeEffectOperation(
        id=str(uuid4()),
        tenant_id=c.actor.tenant_id,
        request_id=ref.request_id,
        invocation_id=ref.invocation_id,
        operation_digest="c" * 64,
        intent_digest="d" * 64,
        scope_digest="e" * 64,
        state="completed",
    )
    c.sql.add(operation)

    def cleanup(*, refs: tuple[NativeTestContextRef, ...]) -> tuple[()]:
        assert refs == (ref,)
        operation.state = (
            "unknown" if changed_fact == "effect" else "claimed" if changed_fact == "claimed-effect" else "completed"
        )
        source.state = "unknown" if changed_fact == "source" else "claimed"
        return ()

    monkeypatch.setattr(c.api.lifecycle.runtime, "cancel", cleanup)
    direct = c.api.lifecycle.cancel(actor=c.actor, request_id=ref.request_id, idempotency_key="fresh-facts")
    assert direct.status == "unknown"
    assert direct.operation_states == {
        operation.id: "unknown" if changed_fact in {"effect", "claimed-effect"} else "completed"
    }
    public = c.api.get(actor=c.actor, session_id="session", request_id=ref.request_id)
    assert public.cancellation == direct
    assert public.outcome == "unknown"
    assert not state.cleanup_complete


def test_cancel_projection_retains_older_unresolved_source(cancel_composition: CancellationCase) -> None:
    """A newer completed acquisition cannot erase an older unresolved source."""
    from uuid import uuid4

    from models.dify_builder_native_tests import NativeTestScope

    c = cancel_composition
    ref, _, state, old, _ = _cancel_projection_post_wait(c, "unknown")
    current = NativeDispatch(
        **{column.key: inspect(old).attrs[column.key].value for column in NativeDispatch.__table__.columns}
    )
    current.id, current.generation, current.state, current.idempotency_digest = str(uuid4()), 1, "completed", "f" * 64
    c.sql.add(current)
    state.generation = cast(NativeTestScope, c.rows[NativeTestScope][0]).generation = 1
    assert (
        c.api.lifecycle.cancel(actor=c.actor, request_id=ref.request_id, idempotency_key="older-unknown").status
        == "unknown"
    )
    assert c.api.get(actor=c.actor, session_id="session", request_id=ref.request_id).outcome == "unknown"
    assert (old.state, current.state, state.generation) == ("unknown", "completed", 1)


@pytest.mark.parametrize(
    "fault", ["missing-source", "foreign-tenant", "foreign-invocation", "future-generation", "missing-context"]
)
def test_cancel_projection_never_infers_clean_from_incomplete_source_history(
    cancel_composition: CancellationCase, fault: str
) -> None:
    from models.dify_builder_native_tests import NativePayloadObject

    c = cancel_composition
    ref, _, state, source, _ = _cancel_projection_post_wait(c, "completed")
    if fault == "missing-source":
        c.rows[NativeDispatch].clear()
    elif fault == "foreign-tenant":
        source.tenant_id = "foreign"
    elif fault == "foreign-invocation":
        source.invocation_id = "foreign"
    elif fault == "future-generation":
        source.generation = 1
    else:
        c.rows[NativePayloadObject].clear()
    direct = c.api.lifecycle.cancel(actor=c.actor, request_id=ref.request_id, idempotency_key="incomplete-source")
    assert direct.status == "cancelling"
    public = c.api.get(actor=c.actor, session_id="session", request_id=ref.request_id)
    assert public.cancellation is not None
    assert public.cancellation.status == "cancelling"
    assert public.outcome is None
    assert state.cleanup_complete


def test_cancel_projection_repeated_cancel_observes_source_state_change(cancel_composition: CancellationCase) -> None:
    c = cancel_composition
    ref, _, state, source, run = _cancel_projection_post_wait(c, "claimed")
    first = c.api.cancel(actor=c.actor, session_id="session", request_id=ref.request_id, idempotency_key="same-cancel")
    assert first.cancellation is not None
    assert first.cancellation.status == "cancelling"
    # Existing finalizer guards still reject this cancellation and the existing
    # exception-tail owner records the unresolved source without clearing ACK.
    c.api.lifecycle._mark_unknown(ref=ref, dispatch_id=source.id)
    second = c.api.cancel(actor=c.actor, session_id="session", request_id=ref.request_id, idempotency_key="same-cancel")
    assert second.cancellation is not None
    assert second.cancellation.status == "unknown"
    assert second.outcome == "unknown"
    assert run.status == "paused"
    assert state.cleanup_complete
    assert source.state == "unknown"
    assert source.generation == state.generation == 0
    assert len(c.published) == 1


@pytest.mark.parametrize(
    ("initial_state", "source_state", "initial_cleanup", "expected", "public_status", "outcome"),
    [
        ("completed", "completed", True, "cancelled", "terminal", "cancelled"),
        ("waiting", "completed", False, "cancelled", "terminal", "cancelled"),
        ("waiting", "claimed", True, "cancelling", "running", None),
        ("waiting", "unknown", True, "unknown", "terminal", "unknown"),
    ],
)
def test_get_cancel_interleaving_refreshes_orm_state_and_projects_one_cancellation(
    cancel_composition: CancellationCase,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    initial_state: str,
    source_state: str,
    initial_cleanup: bool,
    expected: str,
    public_status: str,
    outcome: None | str,
) -> None:
    """Actual SQLite identity map; native SQL/cleanup facts remain explicit unit boundaries.

    GET retains its pre-cancel ORM root. Normal API cancellation runs between
    that state read and the scope read, then an independent SQLite writer mirrors
    its state facts. A regular same-Session SELECT retains the stale identity.
    """
    from uuid import uuid4

    from sqlalchemy import update

    from models.dify_builder import DifyBuilderExecutionRequest
    from models.dify_builder_native_tests import (
        NativeInvocationState,
        NativePendingAction,
        NativeTestInvocation,
        NativeTestScope,
    )
    from tests.unit_tests.services.dify_builder.native_testing.test_host_capacity import Rows

    c = cancel_composition
    ref, context, durable, source, run = _cancel_projection_post_wait(c, source_state)
    durable.state, durable.cleanup_complete = initial_state, initial_cleanup
    if initial_state == "completed":
        durable.outcome, durable.pending_ids, durable.wait_reason = {"native_status": "succeeded"}, list[object](), None
        run.status = WorkflowExecutionStatus.SUCCEEDED
        cast(DifyBuilderExecutionRequest, c.rows[DifyBuilderExecutionRequest][0]).state = "sealed"
        cast(NativeTestInvocation, c.rows[NativeTestInvocation][0]).active = False
    else:
        pending = NativePendingAction(
            id=str(uuid4()),
            tenant_id=c.actor.tenant_id,
            request_id=ref.request_id,
            invocation_id=ref.invocation_id,
            generation=0,
            category="configuration",
            reference_digest="1" * 64,
            reference="configuration",
            owner_ref="configuration-owner",
            owner_version="configuration-v1",
            operation_id=None,
        )
        c.sql.add(pending)
        durable.pending_ids, durable.wait_reason = [pending.id], "configuration"
    historical_status = run.status
    with sqlite_session_factory.begin() as writer:
        writer.add(
            NativeInvocationState(
                **{
                    column.key: inspect(durable).attrs[column.key].value
                    for column in NativeInvocationState.__table__.columns
                }
            )
        )

    if not initial_cleanup:

        def cleanup(*, refs: tuple[NativeTestContextRef, ...]) -> tuple[()]:
            assert refs == (ref,)
            # A committed cleanup-fact boundary, not a physical-verifier witness.
            durable.cleanup_complete = True
            return ()

        monkeypatch.setattr(c.api.lifecycle.runtime, "cancel", cleanup)

    interleaved, cancelling = False, False
    cached: list[NativeInvocationState] = []

    class ProjectionSQL:
        def __init__(self, orm: Session) -> None:
            self.orm = orm

        def scalars[T](self, query: Select[tuple[T]]) -> Rows[T]:
            if query.column_descriptions[0]["entity"] is NativeInvocationState:
                rows = self.orm.scalars(query).all()
                if not cached:
                    cached.extend(cast(Sequence[NativeInvocationState], rows))
                return Rows(rows)
            return c.sql.scalars(query)

        def scalar[T](self, query: Select[tuple[T]]) -> T | None:
            if query.column_descriptions[0]["entity"] is NativeInvocationState:
                return self.orm.scalar(query)
            return c.sql.scalar(query)

        def get[T](self, model: type[T], identity: str) -> T | None:
            nonlocal interleaved, cancelling
            if model is NativeTestScope and not interleaved:
                interleaved = cancelling = True
                try:
                    receipt = c.api.cancel(
                        actor=c.actor,
                        session_id="session",
                        request_id=ref.request_id,
                        idempotency_key="between-get-state-and-scope",
                    )
                    assert receipt.cancellation is not None
                    assert receipt.cancellation.status == expected
                    assert durable.state == "cancelled"
                    with sqlite_session_factory.begin() as writer:
                        writer.execute(
                            update(NativeInvocationState)
                            .where(NativeInvocationState.id == durable.id)
                            .values(
                                state=durable.state,
                                cancellation_key=durable.cancellation_key,
                                cleanup_complete=durable.cleanup_complete,
                            )
                        )
                finally:
                    cancelling = False
                assert len(cached) == 1
                assert cached[0].state == initial_state
                assert cached[0].cleanup_complete is initial_cleanup
            return c.sql.get(model, identity)

    @contextmanager
    def sessions(_factory: object) -> Generator[SQL | ProjectionSQL]:
        if cancelling:
            yield c.sql
        else:
            with sqlite_session_factory() as orm:
                yield ProjectionSQL(orm)

    monkeypatch.setattr(type(c.sessions), "__call__", sessions)
    public = c.api.get(actor=c.actor, session_id="session", request_id=ref.request_id)
    assert interleaved
    assert public.cancellation is not None
    assert public.cancellation.status == expected
    assert public.status == public_status
    assert public.outcome == outcome
    assert public.wait_reason is None
    assert public.pending == ()
    assert public.native_run_id == run.id == context.native_run_id
    assert public.native_status == run.status == historical_status
    assert public.generation == durable.generation == source.generation == 0
    assert source.state == source_state
    assert len(c.published) == 1
    fresh = c.api.get(actor=c.actor, session_id="session", request_id=ref.request_id)
    assert fresh == public


def test_code_capability_requires_explicit_trusted_owner_and_default_stays_http() -> None:
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from services.dify_builder.native_testing.runtime import DifyNativeRuntimeOwner
    from tests.unit_tests.services.dify_builder.native_testing.test_code_qualification import (
        capability,
        qualification,
    )

    ordinary = DifyNativeRuntimeOwner()
    assert ordinary.code_qualification is None
    with pytest.raises(BuilderExecutionPolicyError):
        DifyNativeRuntimeOwner(code_capability=capability())
    q, _ = qualification()
    explicit = DifyNativeRuntimeOwner(code_capability=q)
    assert explicit.code_qualification is q


def dispatch_identity(message: Mapping[str, JsonValue]) -> str:
    identity = message["dispatch_id"]
    assert isinstance(identity, str)
    return identity
