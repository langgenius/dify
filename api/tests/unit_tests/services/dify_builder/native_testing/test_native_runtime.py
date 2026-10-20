"""Actual lifecycle routing; SQL boundary doubles do not establish durability."""

import json
from contextlib import contextmanager
from types import SimpleNamespace
from typing import cast, override

import pytest
from sqlalchemy.orm import Session, sessionmaker

from runtime_contracts.builder.native.runtime_contracts import NativeWorkflowOutcome
from services.dify_builder.native_testing.lifecycle import NativeRuntimePort, NativeTestLifecycleService
from services.dify_builder.native_testing.repository import OwnedNativeTestLoader
from services.dify_builder.native_testing.state_store import NativeExecutionStateStore
from tests.unit_tests.services.dify_builder.native_testing.test_observation_owner import case
from tests.unit_tests.services.dify_builder.native_testing.test_observation_privacy import context as sample_context

__all__ = ["case"]


def test_initial_dispatch_uses_no_checkpoint_and_duplicate_delivery_never_runs_again(monkeypatch):
    context = sample_context()
    calls = []
    claimed = False

    class Runtime:
        def run_initial(self, *, context):
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

        def resume(self, **kwargs):
            del kwargs
            pytest.fail("initial delivery must not restore a checkpoint")

    class Store:
        def load_context(self, *, ref):
            assert ref == context.ref
            return context

        def read_checkpoint(self, **kwargs):
            del kwargs
            pytest.fail("generation zero has no checkpoint")

    @contextmanager
    def locked(**kwargs):
        del kwargs
        yield None, None, None

    lifecycle = NativeTestLifecycleService(
        cast(
            OwnedNativeTestLoader,
            SimpleNamespace(locked=locked, session_factory=lambda: pytest.fail("initial checkpoint SQL")),
        ),
        state_store=cast(NativeExecutionStateStore, Store()),
        runtime=cast(NativeRuntimePort, Runtime()),
    )

    def claim(**kwargs):
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
def test_resume_settlement_refuses_committed_wait_before_actual_finalization(dispatch_state, cleaned):
    from models.dify_builder import DifyBuilderExecutionRequest
    from models.dify_builder_native_tests import NativeDispatch
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from runtime_contracts.builder.native.contracts import CheckpointRef
    from services.dify_builder.native_testing.http_binding import build_native_http_profile
    from services.dify_builder.native_testing.runtime import DifyNativeResumeSettlement
    from tests.unit_tests.services.dify_builder.native_testing.test_host_capacity import SQL

    context = sample_context()
    owned = SimpleNamespace(
        ref=context.ref,
        tenant_id=context.tenant_id,
        actor_id=context.actor_id,
        app_id=context.app_id,
        workflow_id=context.workflow_id,
    )
    state = SimpleNamespace(generation=0, cleanup_complete=cleaned, checkpoint_id="checkpoint")
    rows = {
        DifyBuilderExecutionRequest: [
            SimpleNamespace(
                id=context.ref.request_id,
                tenant_id=context.tenant_id,
                actor_id=context.actor_id,
                context={"profile": build_native_http_profile().model_dump(mode="json")},
            )
        ],
        NativeDispatch: [
            SimpleNamespace(
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


def test_unrestored_host_cannot_authorize_arbitrary_snapshot_or_resume_history():
    from tests.unit_tests.services.dify_builder.native_testing.test_host_execution import LaunchCase

    case = LaunchCase()
    with pytest.raises(ValueError, match="native_resume_unavailable"):
        case.host.require_resume_bindings(entity=object(), runtime_state=object(), response_filter=object())


def test_actual_delivery_capacity_is_bound_before_claim_but_lifetime_stays_inactive(case, monkeypatch):
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


def test_broker_actor_hint_cannot_replace_persisted_request_owner(case):
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
def test_actual_wait_snapshot_restores_exact_objects_journal_and_generation_gap(monkeypatch, generation):
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
    lifecycle = NativeTestLifecycleService(
        cast(OwnedNativeTestLoader, SimpleNamespace(session_factory=initial.sessions)),
        state_store=cast(NativeExecutionStateStore, state),
        resume_settlement=DifyNativeResumeSettlement(),
    )
    checkpoint = CheckpointRef(checkpoint_id="checkpoint", payload_digest="c" * 64)

    def claimed(**kwargs):
        assert kwargs == {"ref": state.context.ref, "generation": generation, "dispatch_id": "resume-delivery"}
        return checkpoint

    monkeypatch.setattr(lifecycle, "claimed_resume_checkpoint", claimed)

    def read_checkpoint(**kwargs):
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
    bind_component_observation(SimpleNamespace(host=host), monkeypatch)
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


def test_actual_stream_cleanup_returns_without_signalling_retired_host(monkeypatch):
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


def test_unknown_joined_owner_can_release_only_actual_dead_dispatcher_lease(monkeypatch):
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


def test_cleanup_only_log_release_refuses_live_dispatcher_and_keeps_original_lease(monkeypatch):
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

    def fetch():
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


def test_resume_history_refuses_fake_host_before_any_repository_cache_or_io():
    from unittest.mock import Mock

    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from services.dify_builder.native_testing.runtime import read_claimed_history

    repository = Mock(side_effect=AssertionError("history IO before actual host"))
    with pytest.raises(BuilderExecutionPolicyError, match="native_resume_owner_mismatch"):
        read_claimed_history(
            host=SimpleNamespace(require_resume_bindings=lambda **_kw: True),
            entity=object(),
            workflow_repository=repository,
            node_repository=repository,
        )
    assert repository.mock_calls == []


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
def test_real_dify_initial_http_wait_and_claimed_resume_keep_same_run(case, monkeypatch, kind, history_fault):
    """Actual Dify generator/runner/Graphon; SQL/storage/C02/quota/HTTP doubles.

    This proves the composition, never database durability or grant authority.
    The separate CI witness runs the actual SQL owners and operation approval.
    """
    from copy import deepcopy
    from unittest.mock import Mock

    import httpx
    from flask import Flask
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
    normalized = []
    original_diagnostic = NativeHostLaunch.diagnostic_event

    def diagnostic(host, *, event):
        maps = [(name, getattr(event, name, None)) for name in ("metadata", "execution_metadata")]
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
                assert type(getattr(observed, name)["total_price"]) is int
                assert getattr(observed, name)["total_price"] == 0
                assert {k: v for k, v in getattr(observed, name).items() if k != "total_price"} == {
                    k: v for k, v in values.items() if k != "total_price"
                }
                normalized.append(kind)
                return observed
        return original_diagnostic(host, event=event)

    monkeypatch.setattr(NativeHostLaunch, "diagnostic_event", diagnostic)
    from services.dify_builder.native_testing.host_execution import _HostObservationLayer

    original_node_context = _HostObservationLayer.node_run_context
    checked_live_phase = []

    @contextmanager
    def node_context(layer, node, *, parent_execution_id=None):
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
        case.rows[DifyBuilderTestInput][0].inputs = inputs
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
    case.rows[Workflow], case.rows[App], case.rows[Account] = [workflow], [app], [account]

    class HistorySQL(SQL):
        """Actual SQL-repository protocol boundary, including pre-cache owner reads."""

        writing = False

        def __call__(self, **kw):
            del kw
            return self

        def __enter__(self):
            return self

        def __exit__(self, *args):
            self.writing = False

        def begin(self):
            self.writing = True
            return self

        @override
        def get(self, model, identity, **kw):
            if kw.get("with_for_update"):
                self.writing = True
            return super().get(model, identity)

        def merge(self, row):
            previous = self.get(type(row), row.id)
            if previous is not None:
                self.rows[type(row)].remove(previous)
            self.rows.setdefault(type(row), []).append(row)
            return row

        def commit(self):
            pass

        def close(self):
            pass

        def expunge_all(self):
            pass

        @override
        def execute(self, _query) -> Rows:
            values = self.scalars(_query)
            return cast(
                Rows, SimpleNamespace(scalars=lambda: SimpleNamespace(first=lambda: values[0] if values else None))
            )

    history = HistorySQL(case.rows, [])
    # The reused single-reader fixture's global SQL depth is unsuitable for
    # actual concurrent workers. This boundary retains per-thread no-IO-in-SQL
    # assertions; it does not replace the production ownership reads.
    from threading import local

    sql_depth = local()

    @contextmanager
    def concurrent_sessions():
        sql_depth.value = getattr(sql_depth, "value", 0) + 1
        try:
            yield SQL(case.rows, case.events)
        finally:
            sql_depth.value -= 1

    case.loader.session_factory = cast(sessionmaker[Session], concurrent_sessions)
    if history_fault is not None and (history_fault.startswith("redirect") or history_fault == "initial-stop"):
        concurrent_sessions.begin = concurrent_sessions

        @contextmanager
        def stop_writer(*, ref, settlement):
            assert settlement is True
            owned = case.loader.load(ref=ref)
            with concurrent_sessions() as session:
                from models.dify_builder_native_tests import NativeTestScope

                yield session, owned, case.rows[NativeTestScope][0]

        monkeypatch.setattr(case.loader, "locked", stop_writer)
        case.local.state = "running"
        case.local.cleanup_complete = False

    def permission(actor, app_id, sessions):
        assert getattr(sql_depth, "value", 0) == 0
        assert actor == case.loader.actor
        assert app_id == context.app_id
        assert sessions is concurrent_sessions

    for permission_path in (
        "services.dify_builder.execution_policy_service.check_execution_permission",
        "services.dify_builder.native_testing.private_reads.check_execution_permission",
        "services.dify_builder.native_testing.http_binding.check_execution_permission",
    ):
        monkeypatch.setattr(permission_path, permission)

    def protected_context(row):
        assert getattr(sql_depth, "value", 0) == 0
        assert row.id == "context"
        return deepcopy(case.context.model_dump(mode="json"))

    monkeypatch.setattr(NativeExecutionStateStore, "_read_object", staticmethod(protected_context))
    monkeypatch.setattr(SQL, "expunge_all", lambda _self: None, raising=False)
    # The loader's SQL boundary is a function fixture, while actual repository
    # constructors require a nominal sessionmaker. Retain their real setup,
    # replacing only that constructor's SQL session boundary in both deliveries.

    def repository_constructor(original):
        def initialize(repo, session_factory, *args, **kwargs):
            del session_factory
            original(repo, sessionmaker(), *args, **kwargs)
            repo._session_factory = history

        return initialize

    for cls in (SQLAlchemyWorkflowExecutionRepository, SQLAlchemyWorkflowNodeExecutionRepository):
        monkeypatch.setattr(cls, "__init__", repository_constructor(cls.__init__))

    def repositories(*, node=False, **kwargs):
        cls = SQLAlchemyWorkflowNodeExecutionRepository if node else SQLAlchemyWorkflowExecutionRepository
        repo = cls(sessionmaker(), context.tenant_id, account, context.app_id, kwargs["triggered_from"])
        repo._session_factory = cast(sessionmaker[Session], history)
        return repo

    monkeypatch.setattr(DifyCoreRepositoryFactory, "create_workflow_execution_repository", repositories)
    monkeypatch.setattr(
        DifyCoreRepositoryFactory,
        "create_workflow_node_execution_repository",
        lambda **kw: repositories(node=True, **kw),
    )
    monkeypatch.setattr(generator_module.session_factory, "create_session", lambda: history)
    monkeypatch.setattr(
        generator_module, "db", SimpleNamespace(engine=object(), session=SimpleNamespace(close=lambda: None))
    )
    monkeypatch.setattr(generator_module, "sessionmaker", lambda **_kw: sessionmaker())
    from core.app.apps import base_app_queue_manager

    monkeypatch.setattr(base_app_queue_manager, "redis_client", Mock())
    monkeypatch.setattr(base_app_queue_manager.AppQueueManager, "_is_stopped", lambda _self: False)
    monkeypatch.setattr(RateLimit, "flush_cache", lambda *_args, **_kw: None)
    for name in ("enter", "exit"):
        monkeypatch.setattr(RateLimit, name, lambda _self, request_id: request_id)
    monkeypatch.setattr(RateLimit, "_get_max_active_requests", lambda *_args: 10, raising=False)

    class ComponentAuthorization:
        """C02 boundary keyed by full operation, including parallel occurrences."""

        def __init__(self):
            from threading import RLock

            self.lock = RLock()
            self.decisions = {0: True}
            self.permits, self.outcomes, self.claimed = {}, {}, set()

        def before_call(self, *, ref, intent):
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

        def claim_dispatch(self, *, ref, intent, permit):
            from runtime_contracts.builder.native.contracts import operation_digest

            assert ref == context.ref
            key = operation_digest(intent.key)
            with self.lock:
                assert permit is self.permits[key]
                assert key not in self.claimed
                self.claimed.add(key)

        def record_outcome(self, *, permit, outcome, result_ref):
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
    private, checkpoints, sends = {}, {}, []
    seal_errors = []
    transition_threads, transition_errors = [], []

    def store_inputs(**kw):
        key = "input-" + kw["native_execution_id"]
        private[key] = deepcopy(kw["inputs"])
        return key

    def store_result(**kw):
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

    def transport(method, url, **kw):
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

    def prepare(generation):
        from models.dify_builder_native_tests import NativeContinuation, NativeDispatch

        lifecycle = NativeTestLifecycleService(
            case.loader, state_store=case.store, resume_settlement=DifyNativeResumeSettlement()
        )
        monkeypatch.setattr(lifecycle, "fence_pending", lambda **_kw: None)
        if history_fault is not None and (history_fault.startswith("redirect") or history_fault == "initial-stop"):
            actual_seal = lifecycle.seal_stop

            def checked_seal(**kw):
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

                        def observe_after_commit():
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
                        case.rows[NativeDispatch][0].state = "unknown"
                    elif history_fault == "redirect-cancelled":
                        case.rows[NativeTestScope][0].cancelled = True
                    elif history_fault == "redirect-ambiguous":
                        raise RuntimeError("seal_commit_ack_lost")
                    elif history_fault == "redirect-unacknowledged":
                        return object()
                    elif history_fault == "redirect-checkpoint":
                        case.rows[NativeContinuation][0].payload_digest = "d" * 64
                    elif history_fault == "redirect-run":
                        runtime.host.lifetime.context.__dict__["native_run_id"] = "foreign-run"
                    return result
                except BaseException as error:
                    seal_errors.append(error)
                    raise

            monkeypatch.setattr(lifecycle, "seal_stop", checked_seal)

        def pause(**kw):
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
            SimpleNamespace(
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
                    SimpleNamespace(
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
                    SimpleNamespace(
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

        def cleanup(**kw):
            runtime.host.lifetime.consume_cleanup(**kw)

        monkeypatch.setattr(runtime.capacity, "record_cleanup", cleanup)
        monkeypatch.setattr(lifecycle, "claimed_resume_checkpoint", lambda **_kw: checkpoint_ref)
        # Only durable cancellation-fence selection is replaced in this unit.
        monkeypatch.setattr(runtime.host._cancellation_fence, "poll", lambda: False)
        return runtime

    application = Flask(__name__)
    with application.app_context():
        initial = prepare(0)
        waiting = initial.run_initial(context=context)
        if history_fault == "initial-stop":
            from models.dify_builder_native_tests import NativeTestInvocation

            assert waiting.status == "stopped"
            assert waiting.reason_code == "effect_denied"
            assert case.request.state == "sealed"
            assert not case.rows[NativeTestInvocation][0].active
            assert initial.host.lifetime._consumed
            assert case.rows[WorkflowRun][0].status == "stopped"
            assert sends == []
            assert thread_errors == []
            return
        assert waiting.status == "waiting"
        assert sends == []
        payload = checkpoints["payload"]
        assert len(payload.node_journals) == len(payload.approval_proposals)
        assert 1 <= len(payload.node_journals) <= (2 if kind == "iteration" else 1)
        assert all(journal.intents for journal in payload.node_journals)
        assert case.rows[WorkflowRun][0].status == "paused"
        original_started = case.rows[WorkflowRun][0].created_at
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
                case.rows[WorkflowRun][0].app_id = "foreign-app"
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
            assert not case.rows[NativeTestInvocation][0].active
            with pytest.raises(BuilderExecutionPolicyError, match="native_invocation_mismatch"):
                case.store.load_context(ref=context.ref)
            assert result.status == "stopped"
            assert result.reason_code == "native_http_redirect_limit"

            assert not resumed.host.lifetime.unknown
            assert resumed.host.lifetime._consumed
            assert len(sends) == 1
            assert case.rows[WorkflowRun][0].status == "stopped"
            assert thread_errors == []
            return
        assert result.status == "completed"
        assert result.native_status == "succeeded"
        assert thread_errors == []
        assert result.native_run_id == waiting.native_run_id
        assert len(sends) == (2 if kind == "iteration" else 1)
        assert len(case.rows[WorkflowRun]) == 1
        assert case.rows[WorkflowRun][0].created_at == original_started
        assert case.rows[WorkflowRun][0].status == "succeeded"
        if kind != "root":
            from models.workflow import WorkflowNodeExecutionModel

            assert checked_live_phase
            assert normalized
            rows = case.rows[WorkflowNodeExecutionModel]
            assert any(row.node_id == "http" and row.execution_metadata_dict.get(kind + "_id") for row in rows)


def install_owner_join_boundary(case, monkeypatch):
    context = case.context
    from models.dify_builder import DifyBuilderSession, DifyBuilderTestInput
    from models.model import App
    from models.workflow import Workflow
    from tests.unit_tests.services.dify_builder.native_testing.test_host_capacity import SQL

    ordinary_scalar = SQL.scalar

    def scoped_owner_join(sql, query):
        if query.column_descriptions[0]["entity"] is DifyBuilderSession and query._setup_joins:
            # This SQL boundary double does not implement joins. Check every
            # modeled joined owner before returning its selected session ID.
            builder = case.rows[DifyBuilderSession][0]
            app, workflow = case.rows[App][0], case.rows[Workflow][0]
            inputs = case.rows[DifyBuilderTestInput][0]
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


def test_actual_inactive_retained_delivery_and_missing_cancel_handles_grant_no_cleanup(case, monkeypatch):
    from models.dify_builder_native_tests import NativeDispatch
    from services.dify_builder.native_testing.lifecycle import NativeDispatchRef
    from services.dify_builder.native_testing.runtime import DifyNativeRuntimeOwner
    from tests.unit_tests.services.dify_builder.native_testing.test_native_observation_wiring import protect_logs

    protect_logs(monkeypatch)
    context = case.context
    case.rows[NativeDispatch] = [
        SimpleNamespace(
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


def test_actual_activated_startup_failure_consumes_only_original_zero_activity_verifier(case, monkeypatch):
    from models.dify_builder_native_tests import NativeDispatch
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
        SimpleNamespace(
            id="start-failed",
            tenant_id=context.tenant_id,
            request_id=context.ref.request_id,
            invocation_id=context.ref.invocation_id,
            generation=0,
            state="claimed",
        )
    ]
    receipts = []

    def cleanup(**identity):
        # Only the SQL ACK is doubled; actual original zero-activity proof is consumed.
        runtime.capacity._verifier.consume_cleanup(**identity)
        receipts.append(identity)

    def unavailable(**kwargs):
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


def test_same_worker_reclaims_over_128_closed_consumed_requests_but_keeps_unknown_live(case, monkeypatch):
    """Actual owner/runtime/registry/verifiers; SQL/claim/object ACK boundaries only."""
    from copy import deepcopy
    from threading import Event, Thread, current_thread

    from models.dify_builder import DifyBuilderExecutionRequest
    from models.dify_builder_native_tests import (
        NativeDispatch,
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
    objects = {}

    def protected_read(row):
        original_read(case.rows[NativePayloadObject][0])  # Preserve fixture's outside-SQL assertion.
        return deepcopy(objects[row.id]) if row.id in objects else case.context.model_dump(mode="json")

    monkeypatch.setattr(NativeExecutionStateStore, "_read_object", staticmethod(protected_read))

    def bridge(*, runtime):
        if runtime.context.ref.request_id == "retained-live":
            return original_bridge(runtime=runtime)
        raise BuilderExecutionPolicyError("native_capability_unavailable")

    monkeypatch.setattr(runtime_module, "build_delivery_bridge", bridge)

    def acquisition(identity):
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
            row.request_id = identity
            if model is NativeInvocationState:
                row.id, row.context_object_id = "state-" + identity, "context-" + identity
            if model is NativePayloadObject:
                row.id = "context-" + identity
                objects[row.id] = context.model_dump(mode="json")
            case.rows[model].append(row)
        dispatch = SimpleNamespace(
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

        def cleanup(**actual):
            runtime.capacity._verifier.consume_cleanup(**actual)

        monkeypatch.setattr(runtime.capacity, "record_cleanup", cleanup)
        return runtime, request

    live, live_request = acquisition("retained-live")
    live._start(live.context)  # Actual claimed-row selection and registry activation.
    entered, release = Event(), Event()

    def background():
        entered.set()
        try:
            assert release.wait(15)
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
        reentered = []

        def retire_during_read(sql, query):
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
def cancel_composition(case, monkeypatch):
    """Real API/compiler/C03/runtime owners; mutable SQL and protected bytes are boundaries."""
    from copy import deepcopy
    from threading import local
    from uuid import uuid4

    from core.dify_builder.input_schema import schema_hash, start_schema
    from core.dify_builder.models import Actor
    from models.dify_builder import DifyBuilderSession, DifyBuilderSessionCommit, DifyBuilderTestInput
    from models.model import App
    from models.workflow import Workflow
    from services.dify_builder.native_testing import state_store as state_module
    from services.dify_builder.native_testing.runtime import DifyNativeRuntimeOwner, build_native_api
    from tests.unit_tests.services.dify_builder.native_testing.test_host_capacity import SQL, Rows
    from tests.unit_tests.services.dify_builder.native_testing.test_native_observation_wiring import protect_logs

    protect_logs(monkeypatch)
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
    case.rows[App][0].mode = "workflow"
    builder = case.rows[DifyBuilderSession][0]
    builder.version = 1
    builder.current_state = "build.review"
    case.rows[DifyBuilderTestInput][0].start_schema_hash = schema_hash(start_schema(workflow.graph_dict, "workflow"))
    case.rows[DifyBuilderSessionCommit] = [
        DifyBuilderSessionCommit(
            id=str(uuid4()),
            session_id=builder.id,
            version=builder.version,
            state=builder.current_state,
            actor="user",
            context={"test_input_ref": case.rows[DifyBuilderTestInput][0].id},
        )
    ]
    for model in tuple(case.rows):
        if model.__module__ == "models.dify_builder_native_tests" or model.__name__ == "DifyBuilderExecutionRequest":
            case.rows[model] = []
    depth = local()

    class MutableSQL(SQL):
        @override
        def get(self, model, identity):
            key = next(iter(model.__table__.primary_key.columns)).key
            return next((row for row in self.rows.get(model, []) if getattr(row, key) == identity), None)

        @override
        def add(self, row):
            for column in row.__table__.columns:
                if getattr(row, column.key) is None and column.default is not None:
                    value = column.default.arg
                    setattr(row, column.key, value(None) if callable(value) else deepcopy(value))
            self.rows.setdefault(type(row), []).append(row)

        @override
        def flush(self):
            pass

        @override
        def execute(self, _query):
            query = _query
            # Reconcile's expired-claim query returns tuples. No claim in this
            # boundary is expired; cancellation scans still use actual scalars.
            if len(query.column_descriptions) > 1:
                from models.dify_builder import DifyBuilderExecutionRequest
                from services.dify_builder.native_testing.repository import utc_now

                dispatches = list(self.scalars(query))
                expiring = any(
                    getattr(clause.left, "key", None) == "claim_expires_at"
                    for clause in query._where_criteria
                    if hasattr(clause, "left")
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
                return result
            return super().execute(query)

    sql = MutableSQL(case.rows, [])

    class Sessions:
        @contextmanager
        def __call__(self):
            yield sql

        @contextmanager
        def begin(self):
            depth.writers = getattr(depth, "writers", 0) + 1
            try:
                yield sql
            finally:
                depth.writers -= 1

    sessions = Sessions()
    actor = Actor(account_id=original.actor_id, tenant_id=original.tenant_id)

    def permission(actual, app_id, source):
        assert not getattr(depth, "writers", 0)
        assert (actual, app_id, source) == (actor, original.app_id, sessions)

    for path in (
        "services.dify_builder.execution_policy_service.check_execution_permission",
        "services.dify_builder.native_testing.private_reads.check_execution_permission",
        "services.dify_builder.native_testing.http_binding.check_execution_permission",
        "services.dify_builder.native_testing.api_service.check_execution_permission",
        "services.dify_builder.native_testing.context_binding.check_execution_permission",
    ):
        monkeypatch.setattr(path, permission)
    objects = {}

    def prepare(store, *, ref, tenant_id, kind, logical_key, payload):
        del store
        assert not getattr(depth, "writers", 0)
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

    def read(row):
        assert not getattr(depth, "writers", 0)
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

    def joined(sql, query):
        if query.column_descriptions[0]["entity"] is DifyBuilderSession and query._setup_joins:
            builder = case.rows[DifyBuilderSession][0]
            assert (builder.tenant_id, builder.owner_account_id, builder.app_id) == (
                actor.tenant_id,
                actor.account_id,
                original.app_id,
            )
            assert workflow.app_id == builder.app_id
            return builder.id
        return scalar(sql, query)

    monkeypatch.setattr(MutableSQL, "scalar", joined)
    owner, published = DifyNativeRuntimeOwner(), []
    api = build_native_api(sessions=sessions, actor=actor, owner=owner, publish=lambda **msg: published.append(msg))
    started = api.start(
        actor=actor,
        session_id="session",
        test_input_id="input",
        expected_version=1,
        mode="native",
        idempotency_key="cancel-composed-start",
    )
    return SimpleNamespace(
        api=api,
        owner=owner,
        published=published,
        sql=sql,
        sessions=sessions,
        actor=actor,
        started=started,
        rows=case.rows,
    )


def test_composed_start_cancel_before_delivery_reconciles_without_physical_acquisition(cancel_composition):
    from models.dify_builder_native_tests import NativeDispatch, NativeInvocationState
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from runtime_contracts.builder.native.contracts import decode_native_ref
    from services.dify_builder.native_testing.lifecycle import NativeDispatchRef

    c = cancel_composition
    assert len(c.published) == 1
    assert c.owner._requests == c.owner._current == {}
    result = c.api.cancel(
        actor=c.actor, session_id="session", request_id=c.started.request_id, idempotency_key="cancel"
    )
    assert result.cancellation.status == "cancelled"
    assert result.status == "terminal"
    assert c.rows[NativeInvocationState][0].cleanup_complete
    assert c.rows[NativeDispatch][0].state == "cancelled"
    assert c.api.lifecycle.reconcile() == 0
    message = c.published[0]
    ref = decode_native_ref(message["ref"])
    late = c.owner.delivery(sessions=c.sessions, delivery=NativeDispatchRef(ref, 0, message["dispatch_id"]))
    with pytest.raises(BuilderExecutionPolicyError, match="native_cancelled"):
        late.execute_dispatch(ref=ref, generation=0, dispatch_id=message["dispatch_id"])
    assert c.owner._requests == c.owner._current == {}
    assert (
        c.api.get(actor=c.actor, session_id="session", request_id=c.started.request_id).cancellation.status
        == "cancelled"
    )


def test_consumed_generation_zero_in_other_owner_cannot_ack_live_generation_one(cancel_composition, monkeypatch):
    """Real two retained owners and worker; SQL claim/resume publication are explicit boundaries."""
    from threading import Event, Thread, current_thread

    from models.dify_builder_native_tests import NativeDispatch, NativeInvocationState, NativeTestScope
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from runtime_contracts.builder.native.contracts import decode_native_ref
    from services.dify_builder.native_testing import runtime as module
    from services.dify_builder.native_testing.lifecycle import NativeDispatchRef

    c = cancel_composition
    message = c.published[0]
    ref = decode_native_ref(message["ref"])
    from tests.unit_tests.services.dify_builder.native_testing.test_native_observation_wiring import protect_logs

    protect_logs(monkeypatch)
    source = c.owner.delivery(sessions=c.sessions, delivery=NativeDispatchRef(ref, 0, message["dispatch_id"]))
    old = source.runtime
    dispatch = c.rows[NativeDispatch][0]
    dispatch.state = "claimed"  # SQL claim ACK boundary, before actual activation.

    def unavailable(**kwargs):
        del kwargs
        raise BuilderExecutionPolicyError("native_capability_unavailable")

    with monkeypatch.context() as broken:
        broken.setattr(module, "build_delivery_bridge", unavailable)
        with pytest.raises(BuilderExecutionPolicyError, match="native_capability_unavailable"):
            old.run_initial(context=old.context)
    assert old.host.lifetime._consumed
    dispatch.state = "completed"
    state = c.rows[NativeInvocationState][0]
    state.generation, state.cleanup_complete = 1, False
    c.rows[NativeTestScope][0].generation = 1
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

    def work():
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
    cancel_composition, monkeypatch, replace_after_settlement
):
    from threading import Thread, current_thread

    from models.dify_builder_native_tests import NativeDispatch, NativeInvocationState
    from runtime_contracts.builder.native.contracts import decode_native_ref
    from services.dify_builder.native_testing import runtime as module
    from services.dify_builder.native_testing.lifecycle import NativeDispatchRef
    from tests.unit_tests.services.dify_builder.native_testing.test_native_observation_wiring import protect_logs

    protect_logs(monkeypatch)
    c = cancel_composition
    message = c.published[0]
    ref = decode_native_ref(message["ref"])
    delivery = NativeDispatchRef(ref, 0, message["dispatch_id"])
    runtime = c.owner.delivery(sessions=c.sessions, delivery=delivery).runtime
    replacement = module.DifyNativeRuntimeOwner().delivery(sessions=c.sessions, delivery=delivery).runtime
    assert isinstance(runtime, module.DifyNativeRuntime)
    assert isinstance(replacement, module.DifyNativeRuntime)
    c.rows[NativeDispatch][0].state = "claimed"  # SQL claim boundary.
    runtime._start(runtime.context)
    worker = Thread(target=lambda: runtime.host.lifetime.thread_finished(thread=current_thread()))
    runtime.host.lifetime.register_thread(thread=worker, role="worker")
    runtime.host.lifetime.start_thread(thread=worker)
    worker.join(2)
    assert not worker.is_alive()
    actual_settle = runtime.host.lifetime.settle

    def settle():
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
    assert result.cancellation.status == "cancelling"
    assert c.rows[NativeInvocationState][0].cleanup_complete is (not replace_after_settlement)
    assert runtime.host.lifetime._consumed is (not replace_after_settlement)
    assert not replacement.host.lifetime._consumed


@pytest.mark.parametrize("history", ["missing-outbox", "prior-lease", "foreign-outbox", "missing-context", "resumed"])
def test_composed_cancel_does_not_upgrade_incomplete_or_noninitial_history(cancel_composition, history):
    from models.dify_builder_native_tests import (
        NativeDispatch,
        NativeInvocationState,
        NativePayloadObject,
        NativeTestScope,
    )
    from services.dify_builder.native_testing.repository import utc_now

    c = cancel_composition
    dispatch, state = c.rows[NativeDispatch][0], c.rows[NativeInvocationState][0]
    if history == "missing-outbox":
        c.rows[NativeDispatch].clear()
    elif history == "prior-lease":
        dispatch.claim_expires_at = utc_now()
    elif history == "foreign-outbox":
        dispatch.tenant_id = "foreign-tenant"
    elif history == "missing-context":
        c.rows[NativePayloadObject].clear()
    elif history == "resumed":
        state.generation = c.rows[NativeTestScope][0].generation = dispatch.generation = 1
    result = c.api.cancel(
        actor=c.actor, session_id="session", request_id=c.started.request_id, idempotency_key="unsafe-history"
    )
    assert result.cancellation.status == "cancelling"
    assert not state.cleanup_complete
    assert c.api.lifecycle.reconcile() == 1
    assert not state.cleanup_complete
    assert c.owner._requests == c.owner._current == {}


def test_delivered_unclaimed_cancel_retires_logically_without_consuming_lifetime(cancel_composition, monkeypatch):
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from runtime_contracts.builder.native.contracts import decode_native_ref
    from services.dify_builder.native_testing.lifecycle import NativeDispatchRef
    from services.dify_builder.native_testing.runtime import DifyNativeRuntime
    from tests.unit_tests.services.dify_builder.native_testing.test_native_observation_wiring import protect_logs

    protect_logs(monkeypatch)
    c = cancel_composition
    message = c.published[0]
    ref = decode_native_ref(message["ref"])
    lifecycle = c.owner.delivery(sessions=c.sessions, delivery=NativeDispatchRef(ref, 0, message["dispatch_id"]))
    runtime = lifecycle.runtime
    assert isinstance(runtime, DifyNativeRuntime)
    assert runtime.host.lifetime._registry is None
    result = c.api.cancel(
        actor=c.actor, session_id="session", request_id=c.started.request_id, idempotency_key="preclaim"
    )
    assert result.cancellation.status == "cancelled"
    with pytest.raises(BuilderExecutionPolicyError, match="native_cancelled"):
        lifecycle.execute_dispatch(ref=ref, generation=0, dispatch_id=message["dispatch_id"])
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
def test_over_128_delivered_unclaimed_logical_cancellations_reclaim_same_worker_slots(cancel_composition, monkeypatch):
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
            delivery=NativeDispatchRef(decode_native_ref(message["ref"]), 0, message["dispatch_id"]),
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
        assert result.cancellation.status == "cancelled"
        assert not runtime.host.lifetime._consumed
        assert runtime.host.lifetime._registry is None
        assert len(c.owner._requests) == len(c.owner._current) == 1
        prior = runtime
    c.owner.retire_closed(sessions=c.sessions)
    assert c.owner._requests == c.owner._current == {}
    assert len(c.published) == 130


@pytest.mark.parametrize("race", ["entry-replaced", "registry-replaced", "activated", "missing-history", "resumed"])
def test_logical_preclaim_retirement_rechecks_proof_and_exact_retained_owners(cancel_composition, monkeypatch, race):
    from threading import Event, Thread, current_thread

    from models.dify_builder_native_tests import NativeDispatch, NativeInvocationState, NativeTestScope
    from runtime_contracts.builder.native.contracts import decode_native_ref
    from services.dify_builder.native_testing import host_capacity
    from services.dify_builder.native_testing.lifecycle import NativeDispatchRef
    from services.dify_builder.native_testing.runtime import DifyNativeRuntime, DifyNativeRuntimeOwner
    from tests.unit_tests.services.dify_builder.native_testing.test_native_observation_wiring import protect_logs

    protect_logs(monkeypatch)
    c = cancel_composition
    message = c.published[0]
    delivery = NativeDispatchRef(decode_native_ref(message["ref"]), 0, message["dispatch_id"])
    runtime = c.owner.delivery(sessions=c.sessions, delivery=delivery).runtime
    replacement = DifyNativeRuntimeOwner().delivery(sessions=c.sessions, delivery=delivery).runtime
    assert isinstance(runtime, DifyNativeRuntime)
    assert isinstance(replacement, DifyNativeRuntime)
    result = c.api.cancel(
        actor=c.actor, session_id="session", request_id=c.started.request_id, idempotency_key="logical-race"
    )
    assert result.cancellation.status == "cancelled"
    if race == "missing-history":
        c.rows[NativeDispatch].clear()
    elif race == "resumed":
        c.rows[NativeInvocationState][0].generation = c.rows[NativeTestScope][0].generation = 1
    actual_proof = host_capacity.finish_unacquired_cancellation
    entered, release = Event(), Event()
    worker = None

    def work():
        entered.set()
        try:
            assert release.wait(10)
        finally:
            runtime.host.lifetime.thread_finished(thread=current_thread())

    def proof(*args, **kwargs):
        nonlocal worker
        result = actual_proof(*args, **kwargs)
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


def _cancel_projection_post_wait(c, dispatch_state):
    """Explicit post-WAIT SQL boundary; no physical or checkpoint attestation."""
    from datetime import datetime
    from uuid import uuid4

    from models.dify_builder import DifyBuilderExecutionRequest
    from models.dify_builder_native_tests import NativeDispatch, NativeInvocationState
    from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
    from models.workflow import WorkflowRun, WorkflowType
    from runtime_contracts.builder.native.contracts import decode_native_ref

    ref = decode_native_ref(c.published[0]["ref"])
    context = c.api.store.load_context(ref=ref)
    state = c.rows[NativeInvocationState][0]
    state.state, state.cleanup_complete = "waiting", True
    state.checkpoint_id = str(uuid4())
    state.pending_ids, state.wait_reason = [str(uuid4())], "approval"
    c.rows[DifyBuilderExecutionRequest][0].state = "waiting"
    dispatch = c.rows[NativeDispatch][0]
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
def test_cancel_projection_includes_owned_sources(cancel_composition, source_owner, source_state, cleaned, expected):
    """Omitting a child/source or treating physical ACK as finalization breaks this table."""
    from uuid import uuid4

    from models.dify_builder_native_tests import (
        NativeDispatch,
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
            **{column.key: getattr(root, column.key) for column in NativeInvocationState.__table__.columns}
        )
        selected.invocation_id, selected.parent_invocation_id = child_id, root.invocation_id
        payload = c.rows[NativePayloadObject][0]
        child_payload = NativePayloadObject(
            **{column.key: getattr(payload, column.key) for column in NativePayloadObject.__table__.columns}
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
            **{column.key: getattr(source, column.key) for column in NativeDispatch.__table__.columns}
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
        assert public.cancellation.status == expected
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
def test_cancel_projection_reloads_after_outside_writer_cleanup(cancel_composition, monkeypatch, changed_fact):
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

    def cleanup(*, refs):
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


def test_cancel_projection_retains_older_unresolved_source(cancel_composition):
    """A newer completed acquisition cannot erase an older unresolved source."""
    from uuid import uuid4

    from models.dify_builder_native_tests import NativeDispatch, NativeTestScope

    c = cancel_composition
    ref, _, state, old, _ = _cancel_projection_post_wait(c, "unknown")
    current = NativeDispatch(**{column.key: getattr(old, column.key) for column in NativeDispatch.__table__.columns})
    current.id, current.generation, current.state, current.idempotency_digest = str(uuid4()), 1, "completed", "f" * 64
    c.sql.add(current)
    state.generation = c.rows[NativeTestScope][0].generation = 1
    assert (
        c.api.lifecycle.cancel(actor=c.actor, request_id=ref.request_id, idempotency_key="older-unknown").status
        == "unknown"
    )
    assert c.api.get(actor=c.actor, session_id="session", request_id=ref.request_id).outcome == "unknown"
    assert (old.state, current.state, state.generation) == ("unknown", "completed", 1)


@pytest.mark.parametrize(
    "fault", ["missing-source", "foreign-tenant", "foreign-invocation", "future-generation", "missing-context"]
)
def test_cancel_projection_never_infers_clean_from_incomplete_source_history(cancel_composition, fault):
    from models.dify_builder_native_tests import NativeDispatch, NativePayloadObject

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
    assert public.cancellation.status == "cancelling"
    assert public.outcome is None
    assert state.cleanup_complete


def test_cancel_projection_repeated_cancel_observes_source_state_change(cancel_composition):
    c = cancel_composition
    ref, _, state, source, run = _cancel_projection_post_wait(c, "claimed")
    first = c.api.cancel(actor=c.actor, session_id="session", request_id=ref.request_id, idempotency_key="same-cancel")
    assert first.cancellation.status == "cancelling"
    # Existing finalizer guards still reject this cancellation and the existing
    # exception-tail owner records the unresolved source without clearing ACK.
    c.api.lifecycle._mark_unknown(ref=ref, dispatch_id=source.id)
    second = c.api.cancel(actor=c.actor, session_id="session", request_id=ref.request_id, idempotency_key="same-cancel")
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
    cancel_composition,
    sqlite_session_factory,
    monkeypatch,
    initial_state,
    source_state,
    initial_cleanup,
    expected,
    public_status,
    outcome,
):
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
        durable.outcome, durable.pending_ids, durable.wait_reason = {"native_status": "succeeded"}, [], None
        run.status = "succeeded"
        c.rows[DifyBuilderExecutionRequest][0].state = "sealed"
        c.rows[NativeTestInvocation][0].active = False
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
                **{column.key: getattr(durable, column.key) for column in NativeInvocationState.__table__.columns}
            )
        )

    if not initial_cleanup:

        def cleanup(*, refs):
            assert refs == (ref,)
            # A committed cleanup-fact boundary, not a physical-verifier witness.
            durable.cleanup_complete = True
            return ()

        monkeypatch.setattr(c.api.lifecycle.runtime, "cancel", cleanup)

    interleaved, cancelling = False, False
    cached = []

    class ProjectionSQL:
        def __init__(self, orm):
            self.orm = orm

        def scalars(self, query):
            if query.column_descriptions[0]["entity"] is NativeInvocationState:
                rows = self.orm.scalars(query).all()
                if not cached:
                    cached.extend(rows)
                return Rows(rows)
            return c.sql.scalars(query)

        def scalar(self, query):
            if query.column_descriptions[0]["entity"] is NativeInvocationState:
                return self.orm.scalar(query)
            return c.sql.scalar(query)

        def get(self, model, identity):
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
    def sessions(_factory):
        if cancelling:
            yield c.sql
        else:
            with sqlite_session_factory() as orm:
                yield ProjectionSQL(orm)

    monkeypatch.setattr(type(c.sessions), "__call__", sessions)
    public = c.api.get(actor=c.actor, session_id="session", request_id=ref.request_id)
    assert interleaved
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


def test_code_capability_requires_explicit_trusted_owner_and_default_stays_http():
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
