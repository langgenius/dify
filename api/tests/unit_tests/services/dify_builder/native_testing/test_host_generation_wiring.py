"""Thin Dify wiring witnesses with actual host/threads/entry/native objects.

Redis, SQL session, quota and response ports are fixtures; no IO integration or
activation/queue/persistence/privacy qualification is claimed.
"""

from __future__ import annotations

import contextvars
import json
from contextlib import nullcontext
from threading import Event, current_thread
from time import monotonic
from types import SimpleNamespace
from typing import Any, cast, override

import pytest
from core.app.apps.workflow.app_generator import WorkflowAppGenerator
from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.workflow.workflow_entry import WorkflowEntry
from flask import Flask
from models.model import App
from models.workflow import Workflow
from services.dify_builder.native_testing.checkpoint_bridge import NativeCheckpointBridge
from services.dify_builder.native_testing.context_binding import NativeContextUnavailable
from services.dify_builder.native_testing.runtime_bridge import NativePreparedInputs, NativeRuntimeBridge
from tests.unit_tests.services.dify_builder.native_testing.test_control import Effects, Factory, Sink, basic, permit
from tests.unit_tests.services.dify_builder.native_testing.test_host_execution import (
    LaunchCase,
    NoCheckpointLifecycle,
    generation_objects,
)

from graphon.graph import Graph
from graphon.graph_engine.command_channels import InMemoryChannel
from graphon.graph_engine.layers import GraphEngineLayer
from graphon.runtime import GraphRuntimeState, VariablePool
from graphon.variable_loader import DUMMY_VARIABLE_LOADER


def runtime_for(case: LaunchCase) -> NativeRuntimeBridge:
    def unused(**kwargs):
        raise AssertionError("no effect preparation is exercised by wiring fixtures")

    return NativeRuntimeBridge(
        state=case.state,
        boundary_owner=case.host.boundary_owner,
        control_sink=cast(Sink, case.host.control_sink),
        collaborators=unused,
        node_arguments=unused,
        prepare_inputs=lambda context: NativePreparedInputs(
            inputs={"guarded": "value"}, files=(), environment_variables=()
        ),
    )


def generate_fixture(case: LaunchCase, monkeypatch: pytest.MonkeyPatch):
    from core.app.apps.workflow import app_generator as module

    entity, _, response_filter, workflow_repo, node_repo = generation_objects(case, monkeypatch)
    generator = WorkflowAppGenerator()
    monkeypatch.setattr(generator, "_bind_file_access_scope", lambda **kwargs: nullcontext())
    monkeypatch.setattr(module, "db", SimpleNamespace(session=SimpleNamespace(close=lambda: None)))
    monkeypatch.setattr(generator, "_get_draft_var_saver_factory", lambda *args, **kwargs: None)
    monkeypatch.setattr(generator, "_handle_response", lambda **kwargs: iter_response())
    monkeypatch.setattr(module.WorkflowAppGenerateResponseConverter, "convert", lambda **kwargs: kwargs["response"])
    arguments: dict[str, Any] = {
        "app_model": SimpleNamespace(mode="workflow", tenant_id=case.state.context.tenant_id),
        "workflow": SimpleNamespace(),
        "user": SimpleNamespace(),
        "application_generate_entity": entity,
        "invoke_from": InvokeFrom.DEBUGGER,
        "workflow_execution_repository": workflow_repo,
        "workflow_node_execution_repository": node_repo,
        "response_stream_filter": response_filter,
        "native_runtime": runtime_for(case),
    }
    return generator, arguments


def iter_response():
    yield {"fixture": "response"}


def test_marked_generate_refuses_missing_host_before_constructing_worker(monkeypatch: pytest.MonkeyPatch) -> None:
    case = LaunchCase()
    generator, arguments = generate_fixture(case, monkeypatch)
    with Flask(__name__).app_context(), pytest.raises(NativeContextUnavailable, match="native_host_unavailable"):
        generator._generate(**arguments)


def test_marked_generate_refuses_foreign_runtime_owner_before_worker(monkeypatch: pytest.MonkeyPatch) -> None:
    case = LaunchCase()
    generator, arguments = generate_fixture(case, monkeypatch)
    arguments["native_runtime"] = runtime_for(LaunchCase())
    with Flask(__name__).app_context(), pytest.raises(NativeContextUnavailable, match="native_host_identity_mismatch"):
        generator._generate(**arguments, native_host=case.host)


def test_generation_bound_before_actual_thread_and_stream_never_joins_it(monkeypatch: pytest.MonkeyPatch) -> None:
    case = LaunchCase()
    generator, arguments = generate_fixture(case, monkeypatch)
    entered, release = Event(), Event()
    workers = []

    def worker(**kwargs):
        workers.append(current_thread())
        assert case.host.generation_bindings.entity is kwargs["application_generate_entity"]
        assert case.host.generation_bindings.response_filter is kwargs["response_stream_filter"]
        entered.set()
        try:
            assert release.wait(3)
        finally:
            case.host.worker_finished(worker=current_thread(), exit_kind="returned")

    monkeypatch.setattr(generator, "_generate_worker", worker)
    monkeypatch.setattr(generator, "_join_worker_thread", lambda worker: pytest.fail("ordinary join used"))
    try:
        with Flask(__name__).app_context():
            source = generator._generate(**arguments, native_host=case.host)
        assert entered.wait(2)
        assert list(source) == [{"fixture": "response"}]
        assert workers[0].is_alive()
        assert case.host.generation_bindings.entity is arguments["application_generate_entity"]
    finally:
        release.set()
        for worker_thread in workers:
            worker_thread.join(2)


def test_owned_worker_preserves_bound_entity_and_reports_finally_on_actual_thread(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from core.app.apps.workflow import app_generator as module

    case = LaunchCase()
    entity, queue, response_filter, workflow_repo, node_repo = generation_objects(case, monkeypatch)
    case.host.bind_generation(
        entity=entity,
        queue=queue,
        response_filter=response_filter,
        workflow_repository=workflow_repo,
        node_repository=node_repo,
    )
    workflow = SimpleNamespace(graph_dict=case.state.context.graph)
    monkeypatch.setattr(
        module.session_factory, "create_session", lambda: nullcontext(SimpleNamespace(scalar=lambda query: workflow))
    )
    seen = []

    class RunnerPort:
        def __init__(self, **kwargs):
            seen.append(kwargs)

        def run(self):
            pass

    monkeypatch.setattr(module, "WorkflowAppRunner", RunnerPort)
    monkeypatch.setattr(module, "active_workflow_task", lambda task: nullcontext())
    finished = []
    original = case.host.worker_finished

    def finished_port(*, worker, exit_kind):
        finished.append((worker, exit_kind, worker.is_alive()))
        original(worker=worker, exit_kind=exit_kind)

    monkeypatch.setattr(case.host, "worker_finished", finished_port)
    from threading import Thread

    worker = Thread(
        target=WorkflowAppGenerator()._generate_worker,
        kwargs={
            "flask_app": Flask(__name__),
            "application_generate_entity": entity,
            "queue_manager": queue,
            "context": contextvars.copy_context(),
            "variable_loader": DUMMY_VARIABLE_LOADER,
            "workflow_execution_repository": workflow_repo,
            "workflow_node_execution_repository": node_repo,
            "response_stream_filter": response_filter,
            "native_runtime": runtime_for(case),
            "native_host": case.host,
        },
    )
    case.host.start_worker(worker=worker)
    worker.join(2)
    assert not worker.is_alive()
    assert seen[0]["application_generate_entity"] is entity
    assert seen[0]["native_host"] is case.host
    assert entity.inputs == {"guarded": "value"}
    assert finished == [(worker, "returned", True)]


def test_entry_installs_actual_host_layer_first_and_disables_raw_observers(monkeypatch: pytest.MonkeyPatch) -> None:
    import core.workflow.workflow_entry as module
    from configs import dify_config

    case = LaunchCase()
    entity, queue, response_filter, workflow_repo, node_repo = generation_objects(case, monkeypatch)
    case.host.bind_generation(
        entity=entity,
        queue=queue,
        response_filter=response_filter,
        workflow_repository=workflow_repo,
        node_repository=node_repo,
    )
    runtime = GraphRuntimeState(variable_pool=VariablePool(), start_at=monotonic())
    config = basic()
    factory = Factory(
        config=config,
        runtime=runtime,
        owner=case.host.boundary_owner,
        sink=cast(Sink, case.host.control_sink),
        effects=Effects(case.host.boundary_owner, permit()),
    )
    graph = Graph.init(graph_config=config, node_factory=factory, root_node_id="start")
    commands = case.host.wrap_commands(channel=InMemoryChannel())
    monkeypatch.setattr(dify_config, "DEBUG", True)
    monkeypatch.setattr(dify_config, "ENABLE_OTEL", True)
    monkeypatch.setattr(module, "DebugLoggingLayer", lambda **kwargs: pytest.fail("raw debug observer"))
    monkeypatch.setattr(module, "ObservabilityLayer", lambda: pytest.fail("raw OTel observer"))
    context = case.state.context
    entry = WorkflowEntry(
        tenant_id=context.tenant_id,
        app_id=context.app_id,
        workflow_id=context.workflow_id,
        graph_config=config,
        graph=graph,
        user_id=context.actor_id,
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
        variable_pool=runtime.variable_pool,
        graph_runtime_state=runtime,
        command_channel=commands,
        response_stream_filter=response_filter,
        native_host=case.host,
    )
    case.host.bind_engine(entry=entry, runtime_state=runtime, response_filter=response_filter, commands=commands)
    assert case.host.engine_bindings.entry is entry
    assert case.host.observation_layer().command_channel is commands


def test_ordinary_none_path_still_uses_existing_worker_join(monkeypatch: pytest.MonkeyPatch) -> None:
    case = LaunchCase()
    generator, arguments = generate_fixture(case, monkeypatch)
    arguments["application_generate_entity"].native_test_required = False
    arguments["application_generate_entity"].native_test_ref = None
    arguments["native_runtime"] = None
    workers = []
    monkeypatch.setattr(generator, "_generate_worker", lambda **kwargs: None)
    from core.app.apps.base_app_generator import BaseAppGenerator

    monkeypatch.setattr(
        BaseAppGenerator, "_join_worker_thread", staticmethod(lambda worker: (worker.join(2), workers.append(worker)))
    )
    with Flask(__name__).app_context():
        source = generator._generate(**arguments)
    assert list(source) == [{"fixture": "response"}]
    assert len(workers) == 1
    assert not workers[0].is_alive()
    from core.app.apps.workflow.app_runner import WorkflowAppRunner

    assert WorkflowAppRunner._run_with_tracing.__qualname__ == "WorkflowAppRunner.run"


def test_prestart_host_refusal_never_runs_actual_worker(monkeypatch: pytest.MonkeyPatch) -> None:
    case = LaunchCase()
    generator, arguments = generate_fixture(case, monkeypatch)
    case.host.request_close(reason="cancel")
    entered = Event()
    monkeypatch.setattr(generator, "_generate_worker", lambda **kwargs: entered.set())
    with Flask(__name__).app_context(), pytest.raises(ValueError, match="native_host_admission_closed"):
        generator._generate(**arguments, native_host=case.host)
    assert not entered.is_set()


def test_native_stream_close_requests_host_without_concurrent_source_close() -> None:
    from threading import Thread

    from services.dify_builder.native_testing import generation_wiring

    case = LaunchCase()
    entered, release, finished = Event(), Event(), Event()
    source_closed = []

    def source():
        try:
            entered.set()
            assert release.wait(3)
            yield {"event": "fixture"}
        finally:
            source_closed.append(current_thread())

    stream = generation_wiring.HostOwnedNativeGeneratorStream(source=source(), host=case.host)
    readers = []

    def read():
        readers.append(current_thread())
        try:
            next(stream)
        finally:
            stream.finish_reader()
            finished.set()

    reader = Thread(target=read)
    reader.start()
    try:
        assert entered.wait(2)
        stream.close()
        assert case.host.settlement_deadline is not None
        assert source_closed == []
        with pytest.raises(NativeContextUnavailable, match="native_stream_reader_mismatch"):
            stream.finish_reader()
    finally:
        release.set()
        reader.join(2)
    assert finished.is_set()
    assert source_closed == readers


@pytest.mark.parametrize("automatic", [False, True])
def test_owned_reader_finalizer_keeps_failed_close_unacknowledged_without_retry(automatic):
    from services.dify_builder.native_testing.generation_wiring import HostOwnedNativeGeneratorStream

    case = LaunchCase()
    attempts = []

    def source():
        try:
            yield {"unserializable": object()} if automatic else "source-value"
        finally:
            attempts.append(current_thread())
            raise RuntimeError("private-close-canary")

    stream = HostOwnedNativeGeneratorStream(source=source(), host=case.host)
    if automatic:
        with pytest.raises(RuntimeError, match="private-close-canary"):
            next(stream)
        with pytest.raises(NativeContextUnavailable, match="^native_stream_close_failed$"):
            stream.finish_reader()
    else:
        next(stream)
        with pytest.raises(RuntimeError, match="private-close-canary"):
            stream.finish_reader()
    with pytest.raises(NativeContextUnavailable, match="^native_stream_close_failed$"):
        stream.finish_reader()
    with pytest.raises(NativeContextUnavailable, match="^native_stream_close_failed$"):
        next(stream)
    assert attempts == [current_thread()]


def test_owned_reader_successful_finalization_is_idempotent():
    from services.dify_builder.native_testing.generation_wiring import HostOwnedNativeGeneratorStream

    case = LaunchCase()
    closed = []

    def source():
        try:
            yield "source-value"
        finally:
            closed.append(current_thread())

    stream = HostOwnedNativeGeneratorStream(source=source(), host=case.host)
    next(stream)
    stream.finish_reader()
    stream.finish_reader()
    assert closed == [current_thread()]


@pytest.mark.parametrize("fails", [False, True])
def test_native_guardrails_bind_actual_release_without_ordinary_early_exit(
    monkeypatch: pytest.MonkeyPatch, fails: bool
) -> None:
    from services import app_generate_service as module
    from tests.unit_tests.services.test_app_generate_service import _DummyRateLimit

    case = LaunchCase()
    exits = []

    class RatePort(_DummyRateLimit):
        @override
        def exit(self, request_id):
            exits.append(request_id)

    monkeypatch.setattr(module, "RateLimit", RatePort)
    monkeypatch.setattr(module.AppGenerateService, "_get_max_active_requests", lambda app: 1)

    from threading import Thread

    entity, queue, response_filter, workflow_repo, node_repo = generation_objects(case, monkeypatch)
    case.host.bind_generation(
        entity=entity,
        queue=queue,
        response_filter=response_filter,
        workflow_repository=workflow_repo,
        node_repository=node_repo,
    )
    workers = []

    def action(rate_limit, request_id):
        if fails:
            raise RuntimeError("fixture setup failure")
        worker = Thread(target=lambda: case.host.worker_finished(worker=current_thread(), exit_kind="returned"))
        workers.append(worker)
        case.host.start_worker(worker=worker)
        return "fixture stream"

    app = App(id=case.state.context.app_id, tenant_id=case.state.context.tenant_id)
    if fails:
        with pytest.raises(RuntimeError, match="fixture setup failure"):
            module.AppGenerateService._run_with_guardrails(
                app_model=app, streaming=True, action=action, native_host=case.host
            )
        assert case.host.settlement_deadline is not None
    else:
        assert (
            module.AppGenerateService._run_with_guardrails(
                app_model=app, streaming=True, action=action, native_host=case.host
            )
            == "fixture stream"
        )
    assert exits == []
    if not fails:
        workers[0].join(2)
        assert not workers[0].is_alive()
        case.host.request_close(reason="exhausted")
        context = case.state.context
        case.lifetime.consume_cleanup(ref=context.ref, generation=context.generation, dispatch_id="dispatch")
        case.host.retire()
        assert exits == ["dummy-request-id"]


def test_actual_runner_passes_same_host_filter_runtime_and_wrapped_combined_channel(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from threading import Thread

    from core.app.apps.workflow import app_runner as module
    from core.app.apps.workflow.command_channels import CombinedCommandChannel
    from services.dify_builder.native_testing.host_lifetime import NativeHostLifetime

    case = LaunchCase(activate=False)
    config = basic()
    case.state.context = case.state.context.model_copy(update={"graph": config})
    case.lifetime = NativeHostLifetime(context=case.state.context, dispatch_id="dispatch")
    case.registry.activate(lifetime=case.lifetime)
    case.host = type(case.host)(
        context=case.state.context,
        dispatch_id="dispatch",
        lifetime=case.lifetime,
        journal=case.journal,
        checkpoints=NativeCheckpointBridge(state=case.state, lifecycle=NoCheckpointLifecycle()),
        fence_pending=case.ports.fence_pending,
        stop_sealer=case.ports,
        authorization=case.authorization,
        http_baseline=(1, 1, 1),
    )
    entity, queue, response_filter, workflow_repo, node_repo = generation_objects(case, monkeypatch)
    case.host.bind_generation(
        entity=entity,
        queue=queue,
        response_filter=response_filter,
        workflow_repository=workflow_repo,
        node_repository=node_repo,
    )
    context = case.state.context
    workflow = Workflow(
        id=context.workflow_id,
        tenant_id=context.tenant_id,
        app_id=context.app_id,
        graph=json.dumps(config),
        type="workflow",
        version="draft",
        kind="standard",
        environment_variables=[],
    )
    entered, release = Event(), Event()
    factories = []
    combined = []

    class LayerPort(GraphEngineLayer):
        def on_graph_start(self):
            pass

        def on_graph_end(self, error):
            pass

        def on_event(self, event):
            pass

        @override
        def on_node_run_start(self, node):
            if node.id == "guard":
                entered.set()
                release.wait(3)

    def build_graph(**kwargs):
        factory = Factory(
            config=config,
            runtime=kwargs["graph_runtime_state"],
            owner=case.host.boundary_owner,
            sink=cast(Sink, case.host.control_sink),
            effects=Effects(case.host.boundary_owner, permit()),
        )
        factories.append(factory)
        return Graph.init(graph_config=config, node_factory=factory, root_node_id="start")

    def build_channel(channels):
        channel = CombinedCommandChannel(channels)
        combined.append(channel)
        return channel

    # Explicit IO-only fixtures. Actual runner, entry, engine, native nodes,
    # combined channel wrapper, filter, host and all Thread/Event witnesses run.
    monkeypatch.setattr(module, "RedisChannel", lambda *args: InMemoryChannel())
    monkeypatch.setattr(module, "StopFlagCommandChannel", lambda **kwargs: InMemoryChannel())
    monkeypatch.setattr(module, "CombinedCommandChannel", build_channel)
    monkeypatch.setattr(module, "attach_stop_aware_ready_queue", lambda *args, **kwargs: None)
    monkeypatch.setattr(module, "WorkflowPersistenceLayer", lambda **kwargs: LayerPort())
    monkeypatch.setattr(module, "build_workflow_agent_workspace_retirement_layer", lambda **kwargs: LayerPort())
    runner = module.WorkflowAppRunner(
        application_generate_entity=entity,
        queue_manager=queue,
        variable_loader=DUMMY_VARIABLE_LOADER,
        workflow=workflow,
        system_user_id=context.actor_id,
        root_node_id="start",
        workflow_execution_repository=workflow_repo,
        workflow_node_execution_repository=node_repo,
        response_stream_filter=response_filter,
        native_runtime=runtime_for(case),
        native_host=case.host,
    )
    monkeypatch.setattr(runner, "_init_graph", build_graph)
    monkeypatch.setattr(runner, "_handle_event", lambda *args: None)
    monkeypatch.setattr(runner, "_run_with_tracing", lambda: pytest.fail("raw trace observer"))
    errors = []

    def run():
        try:
            runner.run()
        except BaseException as error:
            errors.append(error)
        finally:
            case.host.worker_finished(worker=current_thread(), exit_kind="returned")

    worker = Thread(target=run)
    case.host.start_worker(worker=worker)
    try:
        assert entered.wait(2)
        bindings = case.host.engine_bindings
        assert type(bindings.entry) is WorkflowEntry
        assert bindings.runtime_state is factories[0].runtime
        assert bindings.response_filter is response_filter
        assert bindings.commands is bindings.entry.command_channel
        assert bindings.commands is not combined[0]
        scopes = [scope for scope in case.lifetime.active_node_scopes if scope.node.id == "guard"]
        assert len(scopes) == 1
        assert scopes[0].node is bindings.entry.graph_engine.graph.nodes["guard"]
        assert scopes[0].thread.is_alive()
    finally:
        release.set()
        worker.join(2)
    assert not worker.is_alive()
    assert errors == []


def test_marked_non_stream_response_refuses_without_ordinary_join(monkeypatch: pytest.MonkeyPatch) -> None:
    from core.app.apps.workflow import app_generator as module

    case = LaunchCase()
    generator, arguments = generate_fixture(case, monkeypatch)
    monkeypatch.setattr(
        generator,
        "_generate_worker",
        lambda **kwargs: case.host.worker_finished(worker=current_thread(), exit_kind="returned"),
    )
    monkeypatch.setattr(module.WorkflowAppGenerateResponseConverter, "convert", lambda **kwargs: {})
    monkeypatch.setattr(generator, "_join_worker_thread", lambda worker: pytest.fail("ordinary join used"))
    with Flask(__name__).app_context(), pytest.raises(NativeContextUnavailable, match="native_stream_unavailable"):
        generator._generate(**arguments, native_host=case.host)


def test_marked_injected_raw_observer_is_refused_before_worker(monkeypatch: pytest.MonkeyPatch) -> None:
    from graphon.graph_engine.layers import DebugLoggingLayer

    case = LaunchCase()
    generator, arguments = generate_fixture(case, monkeypatch)
    entered = Event()
    monkeypatch.setattr(generator, "_generate_worker", lambda **kwargs: entered.set())
    with Flask(__name__).app_context(), pytest.raises(NativeContextUnavailable, match="native_observation_unqualified"):
        generator._generate(**arguments, native_host=case.host, graph_engine_layers=(DebugLoggingLayer(),))
    assert not entered.is_set()
