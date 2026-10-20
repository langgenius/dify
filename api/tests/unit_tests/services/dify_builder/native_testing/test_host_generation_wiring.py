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
from typing import cast, override

import pytest
from flask import Flask
from typing_extensions import TypedDict

from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.repositories.factory import WorkflowExecutionRepository, WorkflowNodeExecutionRepository
from graphon.engine.command import InMemoryChannel
from graphon.engine.filter import ResponseStreamFilter
from graphon.engine.layer import Layer
from graphon.graph import Graph
from graphon.runtime import RuntimeState, VariablePool
from graphon.variable_loader import DUMMY_VARIABLE_LOADER
from models.account import Account
from models.model import App
from models.workflow import Workflow
from services.dify_builder.native_testing.checkpoint_bridge import NativeCheckpointBridge
from services.dify_builder.native_testing.context_binding import NativeContextUnavailable
from services.dify_builder.native_testing.runtime_bridge import NativePreparedInputs, NativeRuntimeBridge
from services.workflow_runtime.entry import WorkflowEntry
from services.workflow_runtime.workflow_generator import WorkflowAppGenerator
from tests.unit_tests.services.dify_builder.native_testing.test_control import Effects, Factory, Sink, basic, permit
from tests.unit_tests.services.dify_builder.native_testing.test_host_execution import (
    LaunchCase,
    NoCheckpointLifecycle,
    generation_objects,
)


def runtime_for(case: LaunchCase) -> NativeRuntimeBridge:
    def unused(**kwargs):
        del kwargs
        raise AssertionError("no effect preparation is exercised by wiring fixtures")

    return NativeRuntimeBridge(
        state=case.state,
        boundary_owner=case.host.boundary_owner,
        control_sink=cast(Sink, case.host.control_sink),
        collaborators=unused,
        node_arguments=unused,
        prepare_inputs=lambda _context: NativePreparedInputs(
            inputs={"guarded": "value"}, files=(), environment_variables=()
        ),
    )


class _GenerateArguments(TypedDict, closed=True):
    app_model: App
    workflow: Workflow
    user: Account
    application_generate_entity: WorkflowAppGenerateEntity
    invoke_from: InvokeFrom
    workflow_execution_repository: WorkflowExecutionRepository
    workflow_node_execution_repository: WorkflowNodeExecutionRepository
    response_stream_filter: ResponseStreamFilter
    native_runtime: NativeRuntimeBridge | None


def generate_fixture(case: LaunchCase, monkeypatch: pytest.MonkeyPatch):
    from services.workflow_runtime import workflow_generator as module
    from tests.unit_tests.services.dify_builder.native_testing.test_native_observation_wiring import (
        bind_component_observation,
    )

    bind_component_observation(case, monkeypatch)
    entity, _, response_filter, workflow_repo, node_repo = generation_objects(case, monkeypatch)

    def bind_repository_port(*, repository, context, guard):
        assert repository is workflow_repo or repository is node_repo
        # Structural launch fixture only. No history SQL/cache is exercised;
        # real bound repository provenance is covered by owned history tests.
        assert context is case.state.context
        assert guard is case.host.native_observation

    from services.dify_builder.native_testing import generation_wiring

    monkeypatch.setattr(generation_wiring, "bind_native_repository_observation", bind_repository_port)
    from services.workflow_run_agg import WorkflowRunAgg

    generator = WorkflowAppGenerator(execution_driver=WorkflowRunAgg.run)
    monkeypatch.setattr(generator, "_bind_file_access_scope", lambda **_kwargs: nullcontext())
    monkeypatch.setattr(module, "db", SimpleNamespace(session=SimpleNamespace(close=lambda: None)))
    monkeypatch.setattr(generator, "_get_draft_var_saver_factory", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(generator, "_handle_response", lambda **_kwargs: iter_response())
    monkeypatch.setattr(module.WorkflowAppGenerateResponseConverter, "convert", lambda **kwargs: kwargs["response"])
    arguments: _GenerateArguments = {
        "app_model": cast(App, SimpleNamespace(mode="workflow", tenant_id=case.state.context.tenant_id)),
        "workflow": cast(Workflow, SimpleNamespace(features_dict={})),
        "user": cast(Account, SimpleNamespace()),
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
    monkeypatch.setattr(generator, "_join_worker_thread", lambda _worker: pytest.fail("ordinary join used"))
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
    from services.workflow_runtime import workflow_generator as module

    case = LaunchCase()
    entity, queue, response_filter, workflow_repo, node_repo = generation_objects(case, monkeypatch)
    case.host.bind_generation(
        entity=entity,
        queue=queue,
        response_filter=response_filter,
        workflow_repository=workflow_repo,
        node_repository=node_repo,
    )
    from tests.unit_tests.services.dify_builder.native_testing.test_native_observation_wiring import (
        bind_component_observation,
    )

    bind_component_observation(case, monkeypatch)
    workflow = SimpleNamespace(graph_dict=case.state.context.graph)
    monkeypatch.setattr(
        module.session_factory, "create_session", lambda: nullcontext(SimpleNamespace(scalar=lambda _query: workflow))
    )
    seen = []

    class RunnerPort:
        def __init__(self, **kwargs):
            seen.append(kwargs)

        def run(self):
            import logging

            from flask import current_app

            from libs.sensitive_http_telemetry import _sensitive_http
            from services.dify_builder.native_testing.context_runtime import current_native_observation

            assert current_app.name == __name__
            assert _sensitive_http.get()
            assert current_native_observation() is case.host.native_observation
            logging.getLogger("services.workflow_runtime.workflow_generator").error("worker-private-canary")

    monkeypatch.setattr(module, "WorkflowAppRunner", RunnerPort)
    monkeypatch.setattr(module, "active_workflow_task", lambda _task: nullcontext())
    finished = []
    original = case.host.worker_finished

    def finished_port(*, worker, exit_kind):
        finished.append((worker, exit_kind, worker.is_alive()))
        original(worker=worker, exit_kind=exit_kind)

    monkeypatch.setattr(case.host, "worker_finished", finished_port)
    from threading import Thread

    worker = Thread(
        target=WorkflowAppGenerator(execution_driver=lambda runner, *_args: runner.run())._generate_worker,
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
    import services.workflow_runtime.entry as module
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
    from tests.unit_tests.services.dify_builder.native_testing.test_native_observation_wiring import (
        bind_component_observation,
    )

    bind_component_observation(case, monkeypatch)
    runtime = RuntimeState(
        workflow_id=case.state.context.workflow_id, variable_pool=VariablePool(), start_at=monotonic()
    )
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
    monkeypatch.setattr(module, "ObservabilityLayer", lambda: pytest.fail("raw OTel observer"))
    entry = WorkflowEntry(
        graph_config=config,
        graph=graph,
        call_depth=0,
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
    entity = arguments["application_generate_entity"]
    entity.native_test_required = False
    entity.native_test_ref = None
    arguments["native_runtime"] = None
    workers = []
    monkeypatch.setattr(generator, "_generate_worker", lambda **_kwargs: None)
    from core.app.apps.base_app_generator import BaseAppGenerator

    monkeypatch.setattr(
        BaseAppGenerator, "_join_worker_thread", staticmethod(lambda worker: (worker.join(2), workers.append(worker)))
    )
    with Flask(__name__).app_context():
        source = generator._generate(**arguments)
    assert list(source) == [{"fixture": "response"}]
    assert len(workers) == 1
    assert not workers[0].is_alive()
    from services.workflow_run_agg import WorkflowRunAgg

    assert WorkflowRunAgg.run.__qualname__ == "WorkflowRunAgg.run"


def test_prestart_host_refusal_never_runs_actual_worker(monkeypatch: pytest.MonkeyPatch) -> None:
    case = LaunchCase()
    generator, arguments = generate_fixture(case, monkeypatch)
    case.host.request_close(reason="cancel")
    entered = Event()
    monkeypatch.setattr(generator, "_generate_worker", lambda **_kwargs: entered.set())
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
    monkeypatch.setattr(module.AppGenerateService, "_get_max_active_requests", lambda _app: 1)

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
        del rate_limit, request_id
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

    from core.app.apps.workflow.command_channels import CombinedCommandChannel
    from services.dify_builder.native_testing.host_lifetime import NativeHostLifetime
    from services.workflow_runtime import workflow_runner as module

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
    from tests.unit_tests.services.dify_builder.native_testing.test_native_observation_wiring import (
        bind_component_observation,
    )

    guard = bind_component_observation(case, monkeypatch)
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

    class LayerPort(Layer):
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
        from core.app.entities.app_invoke_entities import build_dify_run_context

        run_context = build_dify_run_context(
            tenant_id=context.tenant_id,
            app_id=context.app_id,
            user_id=context.actor_id,
            user_from=kwargs["user_from"],
            invoke_from=kwargs["invoke_from"],
            native_test_required=True,
            native_test_ref=context.ref,
        )
        factory = Factory(
            config=config,
            runtime=kwargs["graph_runtime_state"],
            run_context=run_context,
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
    monkeypatch.setattr(module, "RedisChannel", lambda *_args: InMemoryChannel())
    monkeypatch.setattr(module, "StopFlagCommandChannel", lambda **_kwargs: InMemoryChannel())
    monkeypatch.setattr(module, "CombinedCommandChannel", build_channel)
    monkeypatch.setattr(module, "attach_stop_aware_ready_queue", lambda *_args, **_kwargs: None)

    from unittest.mock import Mock

    from services import workflow_run_agg as aggregate_module

    class PersistencePort(LayerPort):
        def set_node_run_indices(self, indices):
            pass

        def set_node_execution_history(self, histories):
            pass

    def persistence(**kwargs):
        assert kwargs["native_observation"] is guard
        return PersistencePort()

    monkeypatch.setattr(aggregate_module, "WorkflowPersistenceLayer", persistence)
    monkeypatch.setattr(
        aggregate_module, "build_workflow_agent_workspace_retirement_layer", lambda **_kwargs: LayerPort()
    )
    monkeypatch.setattr(aggregate_module.WorkflowRunAgg, "_api_run_repository", lambda _self: Mock())
    monkeypatch.setattr(aggregate_module.WorkflowRunAgg, "_refresh_form_completions", lambda _self: None)
    runner = module.WorkflowAppRunner(
        application_generate_entity=entity,
        queue_manager=queue,
        variable_loader=DUMMY_VARIABLE_LOADER,
        workflow=workflow,
        system_user_id=context.actor_id,
        root_node_id="start",
        response_stream_filter=response_filter,
        native_runtime=runtime_for(case),
        native_host=case.host,
    )
    monkeypatch.setattr(runner, "_init_graph", build_graph)
    monkeypatch.setattr(runner, "handle_event", lambda *_args, **_kwargs: None)
    errors = []

    def run():
        try:
            with case.host.observation_scope():
                aggregate_module.WorkflowRunAgg.run(runner, None, workflow_repo, node_repo)
        except BaseException as error:
            errors.append(error)
        finally:
            case.host.worker_finished(worker=current_thread(), exit_kind="returned")

    worker = Thread(target=run)
    case.host.start_worker(worker=worker)
    try:
        assert entered.wait(2), errors
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
    from services.workflow_runtime import workflow_generator as module

    case = LaunchCase()
    generator, arguments = generate_fixture(case, monkeypatch)
    monkeypatch.setattr(
        generator,
        "_generate_worker",
        lambda **_kwargs: case.host.worker_finished(worker=current_thread(), exit_kind="returned"),
    )
    monkeypatch.setattr(module.WorkflowAppGenerateResponseConverter, "convert", lambda **_kwargs: {})
    monkeypatch.setattr(generator, "_join_worker_thread", lambda _worker: pytest.fail("ordinary join used"))
    with Flask(__name__).app_context(), pytest.raises(NativeContextUnavailable, match="native_stream_unavailable"):
        generator._generate(**arguments, native_host=case.host)


def test_marked_injected_raw_observer_is_refused_before_worker(monkeypatch: pytest.MonkeyPatch) -> None:
    from graphon.engine.layer import Layer

    case = LaunchCase()
    generator, arguments = generate_fixture(case, monkeypatch)
    entered = Event()
    monkeypatch.setattr(generator, "_generate_worker", lambda **_kwargs: entered.set())
    with Flask(__name__).app_context(), pytest.raises(NativeContextUnavailable, match="native_observation_unqualified"):
        generator._generate(**arguments, native_host=case.host, graph_engine_layers=(Layer(),))
    assert not entered.is_set()
