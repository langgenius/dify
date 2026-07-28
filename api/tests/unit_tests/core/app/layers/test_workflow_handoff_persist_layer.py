from collections.abc import Callable
from time import monotonic
from unittest.mock import Mock

import pytest

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.apps.workflow.command_channels import WORKFLOW_WARM_SHUTDOWN_PAUSE_REASON
from core.app.entities.app_invoke_entities import (
    AdvancedChatAppGenerateEntity,
    InvokeFrom,
    RagPipelineGenerateEntity,
    WorkflowAppGenerateEntity,
)
from core.app.layers.pause_state_persist_layer import (
    WORKFLOW_HANDOFF_ACTIVE_EXECUTION_SECONDS_EXTRA_KEY,
    WorkflowResumptionContext,
)
from core.app.layers.workflow_handoff_persist_layer import (
    WorkflowHandoffLayerConfig,
    WorkflowHandoffNotObservedError,
    WorkflowHandoffPersistenceError,
    WorkflowHandoffPersistenceLayer,
    create_workflow_handoff_persistence_layer,
    infer_workflow_handoff_resume_route,
)
from graphon.entities.pause_reason import SchedulingPause
from graphon.filters import ResponseStreamFilter
from graphon.graph_events import GraphRunPausedEvent, GraphRunSucceededEvent
from models.model import AppMode
from models.workflow_handoff import (
    RagPipelineHandoffGroupMetadata,
    RagPipelineQueueKind,
    WorkflowHandoffResumeRoute,
    WorkflowHandoffState,
    WorkflowRunHandoff,
)
from services.workflow_handoff_service import WorkflowHandoffService


def _generate_entity() -> WorkflowAppGenerateEntity:
    return WorkflowAppGenerateEntity(
        task_id="task-123",
        app_config=WorkflowUIBasedAppConfig(
            tenant_id="tenant-123",
            app_id="app-123",
            app_mode=AppMode.WORKFLOW,
            workflow_id="workflow-123",
        ),
        inputs={},
        files=[],
        user_id="user-123",
        stream=False,
        invoke_from=InvokeFrom.DEBUGGER,
        workflow_execution_id="run-123",
    )


def _rag_generate_entity(*, extras: dict[str, object]) -> RagPipelineGenerateEntity:
    app_config = WorkflowUIBasedAppConfig(
        tenant_id="tenant-123",
        app_id="pipeline-123",
        app_mode=AppMode.RAG_PIPELINE,
        workflow_id="workflow-123",
    )
    return RagPipelineGenerateEntity(
        task_id="task-123",
        app_config=app_config,
        pipeline_config=app_config,
        datasource_type="upload_file",
        datasource_info={},
        dataset_id="dataset-123",
        batch="batch-123",
        document_id="document-123",
        inputs={},
        files=[],
        user_id="user-123",
        stream=False,
        invoke_from=InvokeFrom.PUBLISHED_PIPELINE,
        workflow_execution_id="run-123",
        extras=extras,
    )


def _prepared_handoff() -> WorkflowRunHandoff:
    return WorkflowRunHandoff(
        workflow_run_id="run-123",
        generation=1,
        task_id="task-123",
        snapshot_object_key="workflow-run-handoffs/run-123/snapshot.json",
        snapshot_schema_version="workflow-resumption-context/v1",
        snapshot_checksum="checksum",
        snapshot_size_bytes=10,
        resume_route=WorkflowHandoffResumeRoute.WORKFLOW,
        source_worker_id="worker-old",
    )


def _runtime_state() -> Mock:
    state = Mock()
    state.dumps.return_value = '{"runtime": "snapshot"}'
    state.variable_pool.get.return_value = Mock(text="run-123", value="run-123")
    return state


def _response_filter() -> Mock:
    response_filter = Mock(spec=ResponseStreamFilter)
    response_filter.dumps.return_value = '{"filter": "snapshot"}'
    return response_filter


def _maintenance_event() -> GraphRunPausedEvent:
    return GraphRunPausedEvent(
        reasons=[SchedulingPause(message=WORKFLOW_WARM_SHUTDOWN_PAUSE_REASON)],
        outputs={},
    )


def _layer(
    service: Mock | None = None,
    *,
    generate_entity: WorkflowAppGenerateEntity | None = None,
    monotonic_clock: Callable[[], float] | None = None,
) -> tuple[WorkflowHandoffPersistenceLayer, Mock]:
    if service is None:
        resolved_service = Mock(spec=WorkflowHandoffService)
        resolved_service.create_prepared_from_state.return_value = _prepared_handoff()
    else:
        resolved_service = service
    layer = WorkflowHandoffPersistenceLayer(
        handoff_service=resolved_service,
        generate_entity=generate_entity or _generate_entity(),
        source_worker_id="worker-old",
        response_stream_filter=_response_filter(),
        monotonic_clock=monotonic_clock or monotonic,
    )
    layer.initialize(_runtime_state(), Mock())
    layer.set_execution_root_node_id("root-node")
    layer.on_graph_start()
    return layer, resolved_service


def test_maintenance_pause_persists_versioned_context_and_exposes_prepared_handoff() -> None:
    layer, service = _layer()

    layer.on_event(_maintenance_event())

    assert layer.maintenance_pause_observed
    assert layer.persistence_error is None
    assert layer.require_persisted_handoff() is layer.persisted_handoff
    call = service.create_prepared_from_state.call_args.kwargs
    assert call["workflow_run_id"] == "run-123"
    assert call["task_id"] == "task-123"
    assert call["resume_route"] == WorkflowHandoffResumeRoute.WORKFLOW
    assert call["source_worker_id"] == "worker-old"
    context = WorkflowResumptionContext.loads(call["serialized_state"])
    assert context.serialized_graph_runtime_state == '{"runtime": "snapshot"}'
    assert context.serialized_response_stream_filter_state == '{"filter": "snapshot"}'
    resumed_entity = context.get_generate_entity()
    assert isinstance(resumed_entity, WorkflowAppGenerateEntity)
    assert resumed_entity.workflow_execution_id == "run-123"
    assert context.root_node_id == "root-node"


def test_maintenance_pause_accumulates_only_active_segment_time() -> None:
    entity = _generate_entity()
    entity.extras[WORKFLOW_HANDOFF_ACTIVE_EXECUTION_SECONDS_EXTRA_KEY] = 12.5
    clock_values = iter((100.0, 107.25))
    layer, service = _layer(
        generate_entity=entity,
        monotonic_clock=lambda: next(clock_values),
    )

    layer.on_event(_maintenance_event())

    context = WorkflowResumptionContext.loads(service.create_prepared_from_state.call_args.kwargs["serialized_state"])
    assert context.active_execution_seconds == 19.75


def test_rag_maintenance_pause_persists_tenant_slot_group_metadata() -> None:
    entity = _rag_generate_entity(
        extras={
            "source_batch_id": "source-file-123",
            "tenant_id": "tenant-123",
            "queue_kind": "priority",
            "tenant_isolated": True,
        },
    )
    service = Mock(spec=WorkflowHandoffService)
    service.create_prepared_from_state.return_value = _prepared_handoff()
    layer = WorkflowHandoffPersistenceLayer(
        handoff_service=service,
        generate_entity=entity,
        source_worker_id="worker-old",
        response_stream_filter=_response_filter(),
    )
    layer.initialize(_runtime_state(), Mock())
    layer.set_execution_root_node_id("root-node")
    layer.on_graph_start()

    layer.on_event(_maintenance_event())

    assert service.create_prepared_from_state.call_args.kwargs["rag_group_metadata"] == (
        RagPipelineHandoffGroupMetadata(
            source_batch_id="source-file-123",
            tenant_id="tenant-123",
            queue_kind=RagPipelineQueueKind.PRIORITY,
            dataset_id="dataset-123",
            document_id="document-123",
            tenant_isolated=True,
        )
    )


@pytest.mark.parametrize("tenant_isolated", [None, "true"], ids=["missing", "not-boolean"])
def test_rag_maintenance_pause_rejects_ambiguous_tenant_slot_ownership(tenant_isolated: object) -> None:
    extras: dict[str, object] = {
        "source_batch_id": "source-file-123",
        "tenant_id": "tenant-123",
        "queue_kind": "priority",
    }
    if tenant_isolated is not None:
        extras["tenant_isolated"] = tenant_isolated
    service = Mock(spec=WorkflowHandoffService)
    layer = WorkflowHandoffPersistenceLayer(
        handoff_service=service,
        generate_entity=_rag_generate_entity(extras=extras),
        source_worker_id="worker-old",
        response_stream_filter=_response_filter(),
    )
    layer.initialize(_runtime_state(), Mock())
    layer.set_execution_root_node_id("root-node")
    layer.on_graph_start()

    layer.on_event(_maintenance_event())

    assert isinstance(layer.persistence_error, ValueError)
    service.create_prepared_from_state.assert_not_called()
    with pytest.raises(WorkflowHandoffPersistenceError):
        layer.require_persisted_handoff()


def test_non_maintenance_events_are_ignored() -> None:
    layer, service = _layer()

    layer.on_event(GraphRunSucceededEvent(outputs={}))
    layer.on_event(GraphRunPausedEvent(reasons=[SchedulingPause(message="time slice")], outputs={}))

    service.create_prepared_from_state.assert_not_called()
    assert not layer.maintenance_pause_observed
    with pytest.raises(WorkflowHandoffNotObservedError):
        layer.require_persisted_handoff()


def test_persistence_failure_is_retained_for_explicit_fail_closed_check() -> None:
    service = Mock(spec=WorkflowHandoffService)
    persistence_error = RuntimeError("storage unavailable")
    service.create_prepared_from_state.side_effect = persistence_error
    layer, _ = _layer(service)

    # Graphon would swallow a raised layer exception, so on_event records it.
    layer.on_event(_maintenance_event())

    assert layer.persistence_error is persistence_error
    assert layer.persisted_handoff is None
    with pytest.raises(WorkflowHandoffPersistenceError) as raised:
        layer.require_persisted_handoff()
    assert raised.value.__cause__ is persistence_error


def test_factory_honors_explicit_triggered_workflow_route() -> None:
    service = Mock(spec=WorkflowHandoffService)
    config = WorkflowHandoffLayerConfig(
        handoff_service=service,
        source_worker_id="worker-old",
        resume_route=WorkflowHandoffResumeRoute.TRIGGERED_WORKFLOW,
    )

    layer = create_workflow_handoff_persistence_layer(
        config=config,
        generate_entity=_generate_entity(),
        response_stream_filter=_response_filter(),
    )

    assert layer._resume_route == WorkflowHandoffResumeRoute.TRIGGERED_WORKFLOW


@pytest.mark.parametrize(
    ("generate_entity", "expected_route"),
    [
        (WorkflowAppGenerateEntity.model_construct(), WorkflowHandoffResumeRoute.WORKFLOW),
        (AdvancedChatAppGenerateEntity.model_construct(), WorkflowHandoffResumeRoute.ADVANCED_CHAT),
        (RagPipelineGenerateEntity.model_construct(), WorkflowHandoffResumeRoute.RAG_PIPELINE),
    ],
)
def test_resume_route_inference_covers_all_graph_engine_app_modes(
    generate_entity: WorkflowAppGenerateEntity | AdvancedChatAppGenerateEntity | RagPipelineGenerateEntity,
    expected_route: WorkflowHandoffResumeRoute,
) -> None:
    assert infer_workflow_handoff_resume_route(generate_entity) == expected_route


def test_non_resumable_repository_state_is_reported_as_persistence_failure() -> None:
    service = Mock(spec=WorkflowHandoffService)
    failed_handoff = _prepared_handoff()
    failed_handoff.state = WorkflowHandoffState.FAILED
    service.create_prepared_from_state.return_value = failed_handoff
    layer, _ = _layer(service)

    layer.on_event(_maintenance_event())

    with pytest.raises(WorkflowHandoffPersistenceError, match="not persisted"):
        layer.require_persisted_handoff()
