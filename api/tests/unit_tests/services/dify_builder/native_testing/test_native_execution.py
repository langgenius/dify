"""Worker orchestration uses only current protected state and a native owner."""

from unittest.mock import Mock

import pytest

from services.dify_builder.native_testing.context_binding import NativeContextUnavailable
from services.dify_builder.native_testing.runtime_contracts import NativeWorkflowOutcome, ResolvedNativeTestContext
from tests.unit_tests.services.dify_builder.native_testing.test_runtime_contracts import CONTEXT


def service_fixture():
    from services.dify_builder.native_testing.native_execution import NativeWorkflowExecutionService

    context = ResolvedNativeTestContext(**CONTEXT)
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
    from core.app.apps.workflow import app_generator

    generator = app_generator.WorkflowAppGenerator()
    effect = Mock(side_effect=AssertionError("eager file I/O"))
    monkeypatch.setattr(app_generator.file_factory, "build_from_mappings", effect)
    with pytest.raises(NativeContextUnavailable, match="native_context_missing"):
        generator.generate(
            app_model=Mock(),
            workflow=Mock(),
            user=Mock(),
            args={},
            invoke_from=app_generator.InvokeFrom.DEBUGGER,
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


from tests.unit_tests.services.dify_builder.test_execution_policy_service import owned as owned  # noqa: PLC0414


def test_native_owner_calls_existing_generator_with_reserved_id_and_server_actor(owned, monkeypatch):
    from core.app.apps.workflow import app_generator
    from services.dify_builder.native_testing.native_execution import DifyNativeWorkflowOwner
    from services.dify_builder.native_testing.repository import native_workflow_revision

    factory, actor, app, workflow, _, _ = owned
    context = ResolvedNativeTestContext(
        **{
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
    runtime = Mock(resolve=Mock(return_value=context))
    result_owner = Mock()
    owner = DifyNativeWorkflowOwner(session_factory=factory, runtime=runtime, stream_owner=result_owner)
    callback = Mock()
    owner.run(context=context, on_event=callback)
    kwargs = generator.call_args.kwargs
    assert kwargs["workflow_run_id"] == context.native_run_id
    assert kwargs["user"].id == actor.account_id
    assert kwargs["args"]["inputs"] == context.inputs
    assert kwargs["native_test_required"] is True
    assert kwargs["native_test_ref"] == context.ref
    assert kwargs["native_runtime"] is runtime
    assert result_owner.consume.call_args.kwargs["context"] == context
    assert result_owner.consume.call_args.kwargs["stream"].closed is True


def test_ordinary_resume_cannot_rebuild_trace_for_native_marked_entity(monkeypatch):
    from types import SimpleNamespace

    from core.app.apps.workflow import app_generator

    trace = Mock(side_effect=AssertionError("eager trace credentials"))
    monkeypatch.setattr(app_generator, "TraceQueueManager", trace)
    entity = SimpleNamespace(
        native_test_required=True, native_test_ref=None, builder_execution=None, trace_manager=None
    )
    with pytest.raises(NativeContextUnavailable, match="native_context_missing"):
        app_generator.WorkflowAppGenerator().resume(
            app_model=Mock(),
            workflow=Mock(),
            user=Mock(),
            application_generate_entity=entity,
            runtime_state=Mock(),
            workflow_execution_repository=Mock(),
            workflow_node_execution_repository=Mock(),
        )
    trace.assert_not_called()


@pytest.mark.parametrize("ending", ["complete", "close", "error", "startup_error"])
def test_admitted_native_gateway_releases_existing_rate_limit(owned, monkeypatch, ending):
    from core.app.apps.workflow import app_generator
    from core.app.features.rate_limiting.rate_limit import RateLimit
    from services import app_generate_service as module
    from services.dify_builder.native_testing.repository import native_workflow_revision
    from tests.unit_tests.services.test_app_generate_service import _DummyRateLimit

    factory, actor, app, workflow, _, _ = owned
    context = ResolvedNativeTestContext(
        **{
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
        generate = RateLimit.generate

        def exit(self, request_id):
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
    runtime = Mock(resolve=Mock(return_value=context))
    with factory() as session:
        from models.account import Account

        account = session.get(Account, actor.account_id)
    if ending == "startup_error":
        with pytest.raises(RuntimeError, match="startup"):
            module.AppGenerateService.generate_admitted_native(
                app_model=app, workflow=workflow, user=account, ref=context.ref, runtime=runtime
            )
    else:
        stream = module.AppGenerateService.generate_admitted_native(
            app_model=app, workflow=workflow, user=account, ref=context.ref, runtime=runtime
        )
        next(stream)
        if ending == "close":
            stream.close()
        elif ending == "error":
            with pytest.raises(RuntimeError, match="stream interrupted"):
                list(stream)
        else:
            list(stream)
        assert closed == [True]
    assert exits == ["dummy-request-id"]


@pytest.mark.parametrize("refusal", ["reload", "inputs"])
def test_in_process_worker_refusal_terminates_native_queue_without_ordinary_setup(owned, monkeypatch, refusal):
    import contextvars
    from contextlib import nullcontext

    from core.app.apps import base_app_queue_manager
    from core.app.apps.execution_coordinator import AppExecutionState
    from core.app.apps.workflow import app_generator
    from core.app.apps.workflow.app_queue_manager import WorkflowAppQueueManager
    from core.app.entities.queue_entities import QueueErrorEvent
    from models.account import Account
    from services.dify_builder.native_testing.runtime_bridge import NativePreparedInputs, NativeRuntimeBridge

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
    state = Mock(load_context=Mock(return_value=context))
    prepare = Mock(return_value=NativePreparedInputs(inputs=context.inputs, files=(), environment_variables=()))
    bridge = NativeRuntimeBridge(
        state=state, collaborators=Mock(), occurrences=Mock(), node_arguments=Mock(), prepare_inputs=prepare
    )
    generator = app_generator.WorkflowAppGenerator()
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
        workflow_run_id=context.native_run_id,
        native_test_required=True,
        native_test_ref=context.ref,
        native_runtime=bridge,
    )
    entity = launch.call_args.kwargs["application_generate_entity"]
    assert state.load_context.call_count == 1
    assert prepare.call_count == 1
    if refusal == "reload":
        state.load_context.side_effect = RuntimeError("private revoked credential")
        reason = "native_context_unavailable"
    else:
        prepare.side_effect = NativeContextUnavailable("native_input_adapter_unavailable")
        reason = "native_input_adapter_unavailable"
    monkeypatch.setattr(base_app_queue_manager, "redis_client", Mock())
    queue = WorkflowAppQueueManager(entity.task_id, actor.account_id, entity.invoke_from, "workflow")
    monkeypatch.setattr(queue, "_is_stopped", lambda: False)
    monkeypatch.setattr(app_generator, "preserve_flask_contexts", lambda *_args, **_kwargs: nullcontext())
    eager = Mock(side_effect=AssertionError("ordinary SQL/setup"))
    runner = Mock(side_effect=AssertionError("ordinary runner"))
    monkeypatch.setattr(app_generator.session_factory, "create_session", eager)
    monkeypatch.setattr(app_generator, "WorkflowAppRunner", runner)
    generator._generate_worker(
        flask_app=Mock(),
        application_generate_entity=entity,
        queue_manager=queue,
        context=contextvars.copy_context(),
        variable_loader=Mock(),
        workflow_execution_repository=Mock(),
        workflow_node_execution_repository=Mock(),
        native_runtime=bridge,
    )
    assert queue.execution_state is AppExecutionState.TERMINAL
    messages = list(queue.listen())
    assert len(messages) == 1
    assert isinstance(messages[0].event, QueueErrorEvent)
    assert isinstance(messages[0].event.error, NativeContextUnavailable)
    assert str(messages[0].event.error) == reason
    eager.assert_not_called()
    runner.assert_not_called()
