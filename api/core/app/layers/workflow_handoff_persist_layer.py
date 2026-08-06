import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import override

from core.app.apps.workflow.command_channels import is_workflow_warm_shutdown_pause
from core.app.entities.app_invoke_entities import (
    AdvancedChatAppGenerateEntity,
    RagPipelineGenerateEntity,
    WorkflowAppGenerateEntity,
)
from core.app.layers.pause_state_persist_layer import (
    WorkflowResumptionContext,
    get_workflow_handoff_active_execution_seconds,
)
from core.workflow.system_variables import SystemVariableKey, get_system_text
from graphon.filters import ResponseStreamFilter
from graphon.graph_engine.layers import GraphEngineLayer
from graphon.graph_events import GraphEngineEvent, GraphRunPausedEvent
from models.workflow_handoff import (
    RAG_PIPELINE_QUEUE_KIND_EXTRA_KEY,
    RAG_PIPELINE_SOURCE_BATCH_ID_EXTRA_KEY,
    RAG_PIPELINE_TENANT_ID_EXTRA_KEY,
    RAG_PIPELINE_TENANT_ISOLATED_EXTRA_KEY,
    RagPipelineHandoffGroupMetadata,
    RagPipelineQueueKind,
    WorkflowHandoffResumeRoute,
    WorkflowHandoffState,
    WorkflowRunHandoff,
)
from services.workflow_handoff_service import WorkflowHandoffService

logger = logging.getLogger(__name__)

type ResumableWorkflowGenerateEntity = (
    WorkflowAppGenerateEntity | AdvancedChatAppGenerateEntity | RagPipelineGenerateEntity
)


class WorkflowHandoffPersistenceError(RuntimeError):
    """Raised by the explicit post-pause durability check."""


class WorkflowHandoffNotObservedError(RuntimeError):
    """Raised when a caller checks a layer that did not observe maintenance pause."""


@dataclass(frozen=True)
class WorkflowHandoffLayerConfig:
    """Dependencies used to inject durable handoff persistence into a runner."""

    handoff_service: WorkflowHandoffService
    source_worker_id: str
    resume_route: WorkflowHandoffResumeRoute | None = None


class WorkflowHandoffPersistenceLayer(GraphEngineLayer):
    """Persist only planned worker-drain pauses as durable handoff checkpoints.

    Graphon 0.6 logs and swallows exceptions raised by ``GraphEngineLayer.on_event``.
    This layer therefore records any persistence error and exposes
    ``require_persisted_handoff`` as a mandatory post-pause contract for the runner.
    The terminal pause event is notified synchronously before GraphEngine yields it,
    so the result is available when the runner receives that event.
    """

    def __init__(
        self,
        *,
        handoff_service: WorkflowHandoffService,
        generate_entity: ResumableWorkflowGenerateEntity,
        source_worker_id: str,
        response_stream_filter: ResponseStreamFilter,
        resume_route: WorkflowHandoffResumeRoute | None = None,
        monotonic_clock: Callable[[], float] = time.monotonic,
    ) -> None:
        super().__init__()
        self._handoff_service = handoff_service
        self._generate_entity = generate_entity
        self._source_worker_id = source_worker_id
        self._response_stream_filter = response_stream_filter
        self._resume_route = resume_route or infer_workflow_handoff_resume_route(generate_entity)
        self._prior_active_execution_seconds = get_workflow_handoff_active_execution_seconds(generate_entity)
        self._monotonic_clock = monotonic_clock
        self._active_segment_started_at: float | None = None
        self._root_node_id: str | None = None
        self._maintenance_pause_observed = False
        self._persisted_handoff: WorkflowRunHandoff | None = None
        self._persistence_error: Exception | None = None

    @property
    def maintenance_pause_observed(self) -> bool:
        return self._maintenance_pause_observed

    @property
    def persisted_handoff(self) -> WorkflowRunHandoff | None:
        return self._persisted_handoff

    @property
    def persistence_error(self) -> Exception | None:
        return self._persistence_error

    def set_execution_root_node_id(self, root_node_id: str) -> None:
        """Record the exact Graph root before execution starts.

        WorkflowRun.graph preserves the effective graph and version. The root
        is persisted alongside the runtime state because it cannot be inferred
        for custom trigger roots or single iteration/loop debugger runs.
        """
        if not root_node_id:
            raise ValueError("Workflow handoff root node id must not be empty")
        if self._active_segment_started_at is not None:
            raise RuntimeError("Workflow handoff root node id cannot change after graph start")
        if self._root_node_id is not None and self._root_node_id != root_node_id:
            raise RuntimeError("Workflow handoff root node id was configured more than once")
        self._root_node_id = root_node_id

    @override
    def on_graph_start(self) -> None:
        self._maintenance_pause_observed = False
        self._persisted_handoff = None
        self._persistence_error = None
        self._active_segment_started_at = self._monotonic_clock()

    @override
    def on_event(self, event: GraphEngineEvent) -> None:
        if not isinstance(event, GraphRunPausedEvent) or not is_workflow_warm_shutdown_pause(event.reasons):
            return

        self._maintenance_pause_observed = True
        if self._persisted_handoff is not None or self._persistence_error is not None:
            return

        try:
            workflow_run_id = get_system_text(
                self.graph_runtime_state.variable_pool,
                SystemVariableKey.WORKFLOW_EXECUTION_ID,
            )
            if workflow_run_id is None:
                raise ValueError("Workflow execution id is missing from graph runtime state")
            if self._active_segment_started_at is None:
                raise RuntimeError("Workflow handoff layer did not observe graph start")
            if self._root_node_id is None:
                raise RuntimeError("Workflow handoff layer has no execution root node id")
            segment_execution_seconds = max(
                self._monotonic_clock() - self._active_segment_started_at,
                0.0,
            )

            context = WorkflowResumptionContext.from_runtime_snapshot(
                generate_entity=self._generate_entity,
                serialized_graph_runtime_state=self.graph_runtime_state.dumps(),
                serialized_response_stream_filter_state=self._response_stream_filter.dumps(),
                active_execution_seconds=(self._prior_active_execution_seconds + segment_execution_seconds),
                root_node_id=self._root_node_id,
            )
            handoff = self._handoff_service.create_prepared_from_state(
                workflow_run_id=workflow_run_id,
                task_id=self._generate_entity.task_id,
                serialized_state=context.dumps(),
                resume_route=self._resume_route,
                source_worker_id=self._source_worker_id,
                rag_group_metadata=self._rag_group_metadata(),
            )
            if handoff.state != WorkflowHandoffState.PREPARED:
                raise RuntimeError(
                    f"Workflow handoff was persisted in non-resumable state: "
                    f"handoff_id={handoff.id}, state={handoff.state}"
                )
            self._persisted_handoff = handoff
        except Exception as error:
            # Do not rely on raising here: Graphon 0.6 catches layer exceptions.
            # The runner must call require_persisted_handoff after receiving the
            # maintenance pause event and fail closed when this error is present.
            self._persistence_error = error
            logger.exception("Failed to persist workflow handoff checkpoint")

    def _rag_group_metadata(self) -> RagPipelineHandoffGroupMetadata | None:
        if not isinstance(self._generate_entity, RagPipelineGenerateEntity):
            return None
        extras = self._generate_entity.extras
        source_batch_id = extras.get(RAG_PIPELINE_SOURCE_BATCH_ID_EXTRA_KEY)
        tenant_id = extras.get(RAG_PIPELINE_TENANT_ID_EXTRA_KEY)
        queue_kind = extras.get(RAG_PIPELINE_QUEUE_KIND_EXTRA_KEY)
        tenant_isolated = extras.get(RAG_PIPELINE_TENANT_ISOLATED_EXTRA_KEY)
        if source_batch_id is None and tenant_id is None and queue_kind is None and tenant_isolated is None:
            return None
        if not all(
            isinstance(value, str) and value for value in (source_batch_id, tenant_id, queue_kind)
        ) or not isinstance(tenant_isolated, bool):
            raise ValueError("RAG pipeline handoff group metadata is incomplete")
        assert isinstance(source_batch_id, str)
        assert isinstance(tenant_id, str)
        assert isinstance(queue_kind, str)
        return RagPipelineHandoffGroupMetadata(
            source_batch_id=source_batch_id,
            tenant_id=tenant_id,
            queue_kind=RagPipelineQueueKind(queue_kind),
            document_id=self._generate_entity.document_id,
            dataset_id=self._generate_entity.dataset_id,
            tenant_isolated=tenant_isolated,
        )

    @override
    def on_graph_end(self, error: Exception | None) -> None:
        _ = error

    def require_persisted_handoff(self) -> WorkflowRunHandoff:
        """Return the durable row or raise so the caller can fail closed."""
        if not self._maintenance_pause_observed:
            raise WorkflowHandoffNotObservedError("Worker-drain pause was not observed")
        if self._persistence_error is not None:
            raise WorkflowHandoffPersistenceError(
                "Workflow handoff checkpoint was not persisted"
            ) from self._persistence_error
        if self._persisted_handoff is None:
            raise WorkflowHandoffPersistenceError("Workflow handoff checkpoint result is missing")
        return self._persisted_handoff


def infer_workflow_handoff_resume_route(
    generate_entity: ResumableWorkflowGenerateEntity,
) -> WorkflowHandoffResumeRoute:
    """Infer the standard route; triggered workflows explicitly override it."""
    if isinstance(generate_entity, RagPipelineGenerateEntity):
        return WorkflowHandoffResumeRoute.RAG_PIPELINE
    if isinstance(generate_entity, AdvancedChatAppGenerateEntity):
        return WorkflowHandoffResumeRoute.ADVANCED_CHAT
    return WorkflowHandoffResumeRoute.WORKFLOW


def create_workflow_handoff_persistence_layer(
    *,
    config: WorkflowHandoffLayerConfig,
    generate_entity: ResumableWorkflowGenerateEntity,
    response_stream_filter: ResponseStreamFilter,
) -> WorkflowHandoffPersistenceLayer:
    """Construct an injectable handoff layer while keeping generator wiring thin."""
    return WorkflowHandoffPersistenceLayer(
        handoff_service=config.handoff_service,
        generate_entity=generate_entity,
        source_worker_id=config.source_worker_id,
        response_stream_filter=response_stream_filter,
        resume_route=config.resume_route,
    )


__all__ = [
    "ResumableWorkflowGenerateEntity",
    "WorkflowHandoffLayerConfig",
    "WorkflowHandoffNotObservedError",
    "WorkflowHandoffPersistenceError",
    "WorkflowHandoffPersistenceLayer",
    "create_workflow_handoff_persistence_layer",
    "infer_workflow_handoff_resume_route",
]
