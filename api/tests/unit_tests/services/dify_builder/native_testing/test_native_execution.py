"""Worker orchestration uses only current protected state and a native owner."""

from typing import cast, override
from unittest.mock import Mock

import pytest

from runtime_contracts.builder.native.runtime_contracts import NativeWorkflowOutcome, ResolvedNativeTestContext
from services.dify_builder.native_testing.context_binding import NativeContextUnavailable
from tests.unit_tests.services.dify_builder.native_testing.test_runtime_contracts import CONTEXT
from tests.unit_tests.services.dify_builder.test_execution_policy_service import owned

__all__ = ["owned"]


@pytest.mark.parametrize("failed_owner", ["source", "conversion"])
def test_native_stream_failed_close_never_acknowledges_or_retries(failed_owner, monkeypatch):
    from services.dify_builder.native_testing.native_execution import NativeGeneratorStream
    from services.workflow_runtime.workflow_generator import WorkflowAppGenerator

    attempts = []

    def source():
        try:
            yield "source-value"
        finally:
            attempts.append("source")
            if failed_owner == "source":
                raise RuntimeError("private-source-close-canary")

    actual_source = source()

    def conversion(actual):
        try:
            yield next(actual)
        finally:
            attempts.append("conversion")
            if failed_owner == "conversion":
                raise RuntimeError("private-conversion-close-canary")

    monkeypatch.setattr(WorkflowAppGenerator, "convert_to_event_stream", staticmethod(conversion))
    stream = NativeGeneratorStream(actual_source)
    assert next(stream) == "source-value"
    with pytest.raises(RuntimeError, match=f"private-{failed_owner}-close-canary"):
        stream.close()
    assert attempts == ["conversion", "source"]
    with pytest.raises(NativeContextUnavailable, match="^native_stream_close_failed$"):
        stream.close()
    with pytest.raises(NativeContextUnavailable, match="^native_stream_close_failed$"):
        next(stream)
    assert attempts == ["conversion", "source"]


def test_native_stream_successful_close_is_acknowledged_once():
    from services.dify_builder.native_testing.native_execution import NativeGeneratorStream

    attempts = []

    def source():
        try:
            yield "source-value"
        finally:
            attempts.append("source")

    stream = NativeGeneratorStream(source())
    next(stream)
    stream.close()
    stream.close()
    assert attempts == ["source"]
    with pytest.raises(StopIteration):
        next(stream)


def native_host_fixture(context):
    """Actual host/bridge with labeled protected-state and C02/C03 unit ports.

    Local registry activation is test setup, not a durable SQL claim or launch
    qualification. No effect, checkpoint, transport or provider is invoked.
    """
    from services.dify_builder.native_testing.checkpoint_bridge import NativeCheckpointBridge
    from services.dify_builder.native_testing.host_execution import NativeHostLaunch
    from services.dify_builder.native_testing.host_lifetime import NativeHostLifetime, NativeHostLifetimeRegistry
    from services.dify_builder.native_testing.operation_journal import NodeOperationJournal
    from services.dify_builder.native_testing.runtime_bridge import NativePreparedInputs, NativeRuntimeBridge

    state = Mock(load_context=Mock(return_value=context))
    authorization = Mock()
    lifetime = NativeHostLifetime(context=context, dispatch_id="gateway-unit-dispatch")
    registry = NativeHostLifetimeRegistry()
    registry.activate(lifetime=lifetime)
    host = NativeHostLaunch(
        context=context,
        dispatch_id=lifetime.dispatch_id,
        lifetime=lifetime,
        journal=NodeOperationJournal(state=state, authorization=authorization),
        checkpoints=NativeCheckpointBridge(state=state, lifecycle=Mock()),
        fence_pending=Mock(),
        stop_sealer=Mock(),
        authorization=authorization,
        http_baseline=(0.02, 0.02, 0.02),
    )
    prepare = Mock(return_value=NativePreparedInputs(inputs=context.inputs, files=(), environment_variables=()))
    runtime = NativeRuntimeBridge(
        state=state,
        collaborators=Mock(),
        node_arguments=Mock(),
        prepare_inputs=prepare,
        boundary_owner=host.boundary_owner,
        control_sink=host.control_sink,
    )
    return host, runtime, state, prepare


def service_fixture():
    from services.dify_builder.native_testing.native_execution import NativeWorkflowExecutionService

    context = ResolvedNativeTestContext.model_validate(CONTEXT)
    outcome = NativeWorkflowOutcome(
        status="completed",
        ref=context.ref,
        native_run_id=context.native_run_id,
        checkpoint_ref=None,
        pending_operation_ids=(),
        reason_code=None,
        wait_reason=None,
        native_status="failed",
        output_result_ref=None,
    )
    state = Mock(load_context=Mock(return_value=context))
    owner = Mock(run=Mock(return_value=outcome), resume=Mock(return_value=outcome))
    return context, state, owner, NativeWorkflowExecutionService(state=state, native_owner=owner)


def test_run_uses_reloaded_typed_snapshot_and_exact_native_run_id():
    context, state, owner, service = service_fixture()
    callback = Mock()
    result = service.run(ref=context.ref, on_event=callback)
    assert result.native_status == "failed"
    assert owner.run.call_args.kwargs["context"] == context
    assert owner.run.call_args.kwargs["on_event"] is callback
    state.load_context.assert_called_once_with(ref=context.ref)


def test_resume_checks_generation_before_native_owner():
    context, _, owner, service = service_fixture()
    with pytest.raises(NativeContextUnavailable, match="native_generation_conflict"):
        service.resume_worker(ref=context.ref, generation=1)
    owner.resume.assert_not_called()


def test_resume_reloads_state_each_time():
    context, state, owner, service = service_fixture()
    service.resume_worker(ref=context.ref, generation=0)
    state.load_context.side_effect = ValueError("private credential value")
    with pytest.raises(NativeContextUnavailable, match="^native_context_unavailable$"):
        service.resume_worker(ref=context.ref, generation=0)
    assert owner.resume.call_count == 1


def test_owner_cannot_replace_reserved_run_identity():
    context, _, owner, service = service_fixture()
    owner.run.return_value = owner.run.return_value.model_copy(update={"native_run_id": "other-run"})
    with pytest.raises(NativeContextUnavailable, match="native_run_identity_mismatch"):
        service.run(ref=context.ref, on_event=Mock())


def test_generator_refuses_missing_native_scope_before_file_or_config_work(monkeypatch):
    from services.workflow_run_agg import WorkflowRunAgg
    from services.workflow_runtime import workflow_generator as app_generator

    generator = app_generator.WorkflowAppGenerator(execution_driver=WorkflowRunAgg.run)
    effect = Mock(side_effect=AssertionError("eager file I/O"))
    monkeypatch.setattr(app_generator.file_factory, "build_from_mappings", effect)
    with pytest.raises(NativeContextUnavailable, match="native_context_missing"):
        generator.generate(
            app_model=Mock(),
            workflow=Mock(),
            user=Mock(),
            args={},
            invoke_from=app_generator.InvokeFrom.DEBUGGER,
            streaming=True,
            call_depth=0,
            native_test_required=True,
        )
    effect.assert_not_called()


def test_worker_rejects_marker_before_payload_logger_or_ordinary_runner(monkeypatch):
    from tasks.app_generate import workflow_execute_task as module

    context, _, _, _ = service_fixture()
    params = module.AppExecutionParams(
        app_id="app",
        workflow_id="workflow",
        tenant_id="tenant",
        user={"TYPE": "account", "user_id": "u"},
        args={},
        invoke_from="debugger",
        native_test_required=True,
        native_test_ref=context.ref,
    )
    ordinary = Mock(side_effect=AssertionError("ordinary worker"))
    logger = Mock()
    monkeypatch.setattr(module, "_AppRunner", ordinary)
    monkeypatch.setattr(module, "logger", logger)
    monkeypatch.setattr(module, "db", Mock(engine=object()))
    with pytest.raises(NativeContextUnavailable, match="native_runtime_unavailable"):
        module.workflow_based_app_execution_task(params.model_dump_json())
    ordinary.assert_not_called()
    logger.info.assert_not_called()


def test_native_owner_calls_existing_generator_with_reserved_id_and_server_actor(owned, monkeypatch):
    from services.dify_builder.native_testing.native_execution import DifyNativeWorkflowOwner
    from services.dify_builder.native_testing.repository import native_workflow_revision
    from services.workflow_runtime import workflow_generator as app_generator

    factory, actor, app, workflow, _, _ = owned
    context = ResolvedNativeTestContext.model_validate(
        {
            **CONTEXT,
            "tenant_id": actor.tenant_id,
            "actor_id": actor.account_id,
            "app_id": app.id,
            "workflow_id": workflow.id,
            "graph": workflow.graph_dict,
            "graph_revision": native_workflow_revision(workflow),
        }
    )
    stream = iter([{"event": "workflow_started"}])
    generator = Mock(return_value=stream)
    monkeypatch.setattr(app_generator.WorkflowAppGenerator, "generate", generator)
    host, runtime, _, _ = native_host_fixture(context)
    result_owner = Mock()

    def consume(**kwargs):
        actual_stream = kwargs["stream"]
        try:
            list(actual_stream)
        finally:
            actual_stream.finish_reader()

    result_owner.consume.side_effect = consume
    owner = DifyNativeWorkflowOwner(
        session_factory=factory, runtime=runtime, stream_owner=result_owner, native_host=host
    )
    callback = Mock()
    owner.run(context=context, on_event=callback)
    kwargs = generator.call_args.kwargs
    assert kwargs["workflow_run_id"] == context.native_run_id
    assert kwargs["user"].id == actor.account_id
    assert kwargs["args"]["inputs"] == context.inputs
    assert kwargs["native_test_required"] is True
    assert kwargs["native_test_ref"] == context.ref
    assert kwargs["native_runtime"] is runtime
    assert kwargs["native_host"] is host
    assert result_owner.consume.call_args.kwargs["context"] == context
    assert host.settlement_deadline is not None


def test_ordinary_resume_cannot_rebuild_trace_for_native_marked_entity(monkeypatch):
    from services.workflow_runtime import workflow_generator as app_generator

    trace = Mock(side_effect=AssertionError("eager trace credentials"))
    monkeypatch.setattr(app_generator, "TraceQueueManager", trace)
    entity = app_generator.WorkflowAppGenerateEntity.model_construct(
        native_test_required=True, native_test_ref=None, builder_execution=None, trace_manager=None
    )
    from services.workflow_run_agg import WorkflowRunAgg

    def resume():
        app_generator.WorkflowAppGenerator(execution_driver=WorkflowRunAgg.run).resume(
            app_model=Mock(),
            workflow=Mock(),
            user=Mock(),
            application_generate_entity=entity,
            graph_runtime_state=Mock(),
            workflow_execution_repository=Mock(),
            workflow_node_execution_repository=Mock(),
        )

    with pytest.raises(NativeContextUnavailable, match="native_context_missing"):
        resume()
    trace.assert_not_called()


@pytest.mark.parametrize("ending", ["complete", "close", "error", "startup_error"])
def test_admitted_native_gateway_retains_rate_release_until_host_cleanup(owned, monkeypatch, ending):
    from core.app.features.rate_limiting.rate_limit import RateLimit
    from services import app_generate_service as module
    from services.dify_builder.native_testing.repository import native_workflow_revision
    from services.workflow_runtime import workflow_generator as app_generator
    from tests.unit_tests.services.test_app_generate_service import _DummyRateLimit

    factory, actor, app, workflow, _, _ = owned
    context = ResolvedNativeTestContext.model_validate(
        {
            **CONTEXT,
            "tenant_id": actor.tenant_id,
            "actor_id": actor.account_id,
            "app_id": app.id,
            "workflow_id": workflow.id,
            "graph": workflow.graph_dict,
            "graph_revision": native_workflow_revision(workflow),
        }
    )
    exits = []
    closed = []

    class TrackingLimit(_DummyRateLimit):
        @override
        def generate(self, generator, request_id: str):
            return RateLimit.generate(cast(RateLimit, self), generator, request_id)

        @override
        def exit(self, request_id: str) -> None:
            exits.append(request_id)

    def source():
        try:
            yield {"event": "workflow_started"}
            if ending == "error":
                raise RuntimeError("stream interrupted")
            yield {"event": "workflow_finished"}
        finally:
            closed.append(True)

    monkeypatch.setattr(module, "RateLimit", TrackingLimit)
    monkeypatch.setattr(module.AppGenerateService, "_get_max_active_requests", lambda _: 10)
    monkeypatch.setattr(
        app_generator.WorkflowAppGenerator,
        "generate",
        Mock(
            side_effect=RuntimeError("startup") if ending == "startup_error" else None,
            return_value=source(),
        ),
    )
    host, runtime, _, _ = native_host_fixture(context)
    with factory() as session:
        from models.account import Account

        account = session.get(Account, actor.account_id)
    if ending == "startup_error":
        with pytest.raises(RuntimeError, match="startup"):
            module.AppGenerateService.generate_admitted_native(
                app_model=app, workflow=workflow, user=account, ref=context.ref, runtime=runtime, native_host=host
            )
    else:
        stream = module.AppGenerateService.generate_admitted_native(
            app_model=app, workflow=workflow, user=account, ref=context.ref, runtime=runtime, native_host=host
        )
        next(stream)
        if ending == "close":
            stream.close()
            assert closed == []
            assert exits == []
        elif ending == "error":
            with pytest.raises(RuntimeError, match="stream interrupted"):
                list(stream)
        else:
            list(stream)
        from services.dify_builder.native_testing.generation_wiring import HostOwnedNativeGeneratorStream

        assert isinstance(stream, HostOwnedNativeGeneratorStream)
        stream.finish_reader()
        assert closed == [True]
    # Startup refusal, consumer close and source exhaustion are not actual
    # physical cleanup. The separately tested exact host verifier owns release.
    assert exits == []
    assert host.settlement_deadline is not None


@pytest.mark.parametrize("refusal", ["reload", "inputs"])
def test_in_process_worker_refusal_terminates_native_queue_without_ordinary_setup(owned, monkeypatch, refusal):
    _worker_refusal_case(owned, monkeypatch, refusal=refusal, redis_failure=False)


def _worker_refusal_case(owned, monkeypatch, *, refusal, redis_failure):
    import contextvars

    from flask import Flask

    from core.app.apps import base_app_queue_manager
    from core.app.apps.execution_coordinator import AppExecutionState
    from core.app.entities.queue_entities import QueueErrorEvent
    from models.account import Account
    from services.workflow_runtime import workflow_generator as app_generator
    from services.workflow_runtime.workflow_queue import WorkflowAppQueueManager

    factory, actor, app, workflow, _, _ = owned
    with factory() as sql:
        account = sql.get(Account, actor.account_id)
        sql.expunge(account)
    context = ResolvedNativeTestContext.model_validate(
        {
            **CONTEXT,
            "tenant_id": actor.tenant_id,
            "actor_id": actor.account_id,
            "app_id": app.id,
            "workflow_id": workflow.id,
            "graph": workflow.graph_dict,
        }
    )
    host, bridge, state, prepare = native_host_fixture(context)
    from types import SimpleNamespace

    from tests.unit_tests.services.dify_builder.native_testing.test_native_observation_wiring import (
        bind_component_observation,
        protect_logs,
    )

    # Structural component guard only: this fixture supplies no persisted
    # HTTP profile, SQL claim, transport or production qualification proof.
    guard = bind_component_observation(SimpleNamespace(host=host), monkeypatch)
    output = protect_logs(monkeypatch)
    state.load_context.reset_mock()
    from services.workflow_run_agg import WorkflowRunAgg

    generator = app_generator.WorkflowAppGenerator(execution_driver=WorkflowRunAgg.run)
    launch = Mock()
    monkeypatch.setattr(generator, "_generate", launch)
    monkeypatch.setattr(app_generator, "db", Mock(engine=factory.kw["bind"]))
    monkeypatch.setattr(app_generator, "DifyCoreRepositoryFactory", Mock())
    generator.generate(
        app_model=app,
        workflow=workflow,
        user=account,
        args={"inputs": context.inputs},
        invoke_from=app_generator.InvokeFrom.DEBUGGER,
        streaming=True,
        call_depth=context.call_depth,
        workflow_run_id=context.native_run_id,
        native_test_required=True,
        native_test_ref=context.ref,
        native_runtime=bridge,
        native_host=host,
    )
    entity = launch.call_args.kwargs["application_generate_entity"]
    assert state.load_context.call_count >= 2
    assert prepare.call_count == 1
    if refusal == "reload":
        # Revoke before actual worker scope entry, including its current-owner read.
        state.load_context.side_effect = RuntimeError("private revoked credential")
        reason = "native_context_unavailable"
    else:
        prepare.side_effect = NativeContextUnavailable("native_input_adapter_unavailable")
        reason = "native_input_adapter_unavailable"
    redis_port = Mock()
    if redis_failure:
        from redis.exceptions import RedisError

        redis_port.delete.side_effect = RedisError("private-redis-delete-canary")
    monkeypatch.setattr(base_app_queue_manager, "redis_client", redis_port)
    queue = WorkflowAppQueueManager(
        entity.task_id, actor.account_id, entity.invoke_from, "workflow", native_observation=guard
    )
    from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
    from core.repositories.sqlalchemy_workflow_node_execution_repository import (
        SQLAlchemyWorkflowNodeExecutionRepository,
    )
    from graphon.engine.filter import ResponseStreamFilter

    # Actual synchronous repository constructors are retained; this early
    # refusal path must never invoke their SQL/save/serialization methods.
    workflow_repo = SQLAlchemyWorkflowExecutionRepository(factory, context.tenant_id, account, context.app_id, None)
    node_repo = SQLAlchemyWorkflowNodeExecutionRepository(factory, context.tenant_id, account, context.app_id, None)
    host.bind_generation(
        entity=entity,
        queue=queue,
        response_filter=ResponseStreamFilter(),
        workflow_repository=workflow_repo,
        node_repository=node_repo,
    )
    monkeypatch.setattr(queue, "_is_stopped", lambda: False)
    eager = Mock(side_effect=AssertionError("ordinary SQL/setup"))
    runner = Mock(side_effect=AssertionError("ordinary runner"))
    monkeypatch.setattr(app_generator.session_factory, "create_session", eager)
    monkeypatch.setattr(app_generator, "WorkflowAppRunner", runner)
    from threading import Thread

    worker_arguments = {
        "flask_app": Flask(__name__),
        "application_generate_entity": entity,
        "queue_manager": queue,
        "context": contextvars.copy_context(),
        "variable_loader": Mock(),
        "workflow_execution_repository": workflow_repo,
        "workflow_node_execution_repository": node_repo,
        "native_runtime": bridge,
        "native_host": host,
    }
    restored_context = []

    def run_worker():
        import logging

        from libs.sensitive_http_telemetry import _sensitive_http
        from services.dify_builder.native_testing.context_runtime import current_native_observation

        generator._generate_worker(**worker_arguments)
        restored_context.append((_sensitive_http.get(), current_native_observation()))
        logging.getLogger("core.app.apps.base_app_queue_manager").warning("ordinary-after-native-worker")

    worker = Thread(target=run_worker)
    # This direct worker refusal uses the actual host's bound generation and
    # owned Thread start/finally; fixture SQL/Redis ports remain unqualified.
    host.start_worker(worker=worker)
    worker.join(timeout=3)
    assert not worker.is_alive()
    assert queue.execution_state is AppExecutionState.TERMINAL
    messages = list(queue.listen())
    if refusal == "reload":
        # A failed guard cannot safely project a new queue payload. Listener
        # termination and unknown ownership do not acknowledge physical cleanup.
        assert messages == []
        assert host.lifetime.unknown
        with pytest.raises(ValueError, match="^native_host_cleanup_incomplete$"):
            host.lifetime.consume_cleanup(
                ref=context.ref, generation=context.generation, dispatch_id=host.lifetime.dispatch_id
            )
    else:
        assert len(messages) == 1
        assert isinstance(messages[0].event, QueueErrorEvent)
        assert isinstance(messages[0].event.error, str)
        assert str(messages[0].event.error) == guard.error(NativeContextUnavailable(reason))
        assert "private revoked credential" not in str(messages[0].event.error)
    assert restored_context == [(False, None)]
    assert "ordinary-after-native-worker" in output.getvalue()
    assert "private revoked credential" not in output.getvalue()
    assert "private-redis-delete-canary" not in output.getvalue()
    assert entity.task_id not in output.getvalue()
    assert "Failed to clear task belong cache" not in output.getvalue()
    eager.assert_not_called()
    runner.assert_not_called()


def test_early_worker_revocation_redis_cleanup_cannot_log_private_payload(owned, monkeypatch):
    _worker_refusal_case(owned, monkeypatch, refusal="reload", redis_failure=True)


@pytest.mark.parametrize("invalid_host", [None, object()])
def test_native_owner_requires_explicit_actual_host(invalid_host):
    from services.dify_builder.native_testing.native_execution import DifyNativeWorkflowOwner

    with pytest.raises(NativeContextUnavailable, match="native_host_unavailable"):
        DifyNativeWorkflowOwner(session_factory=Mock(), runtime=Mock(), stream_owner=Mock(), native_host=invalid_host)


def test_native_owner_rejects_foreign_host_before_sql_or_generator():
    from services.dify_builder.native_testing.native_execution import DifyNativeWorkflowOwner

    context = ResolvedNativeTestContext.model_validate(CONTEXT)
    host, _, _, _ = native_host_fixture(context)
    _, foreign_runtime, _, _ = native_host_fixture(context)
    sessions = Mock(side_effect=AssertionError("eager SQL"))
    stream_owner = Mock()
    owner = DifyNativeWorkflowOwner(
        session_factory=sessions, runtime=foreign_runtime, stream_owner=stream_owner, native_host=host
    )
    with pytest.raises(NativeContextUnavailable, match="native_host_identity_mismatch"):
        owner.run(context=context, on_event=Mock())
    sessions.assert_not_called()
    stream_owner.consume.assert_not_called()
    with pytest.raises(NativeContextUnavailable, match="native_host_identity_mismatch"):
        owner.resume(context=context, generation=context.generation)
    stream_owner.resume.assert_not_called()
