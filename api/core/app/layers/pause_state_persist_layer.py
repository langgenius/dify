import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated, Literal, Protocol, Self, override, runtime_checkable

from pydantic import BaseModel, Field
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.app.apps.workflow.command_channels import is_workflow_warm_shutdown_pause
from core.app.entities.app_invoke_entities import (
    AdvancedChatAppGenerateEntity,
    RagPipelineGenerateEntity,
    WorkflowAppGenerateEntity,
)
from core.repositories.human_input_repository import HumanInputFormSubmissionRepository
from core.workflow.nodes.human_input.boundary import enrich_graph_pause_reasons
from core.workflow.system_variables import SystemVariableKey, get_system_text
from graphon.filters import ResponseStreamFilter
from graphon.graph_engine.layers import GraphEngineLayer
from graphon.graph_events import GraphEngineEvent, GraphRunPausedEvent
from models.model import AppMode
from repositories.api_workflow_run_repository import APIWorkflowRunRepository
from repositories.factory import DifyAPIRepositoryFactory

WORKFLOW_HANDOFF_ACTIVE_EXECUTION_SECONDS_EXTRA_KEY = "workflow_handoff_active_execution_seconds"


@runtime_checkable
class _GenerateEntityExtras(Protocol):
    @property
    def extras(self) -> object: ...


def get_workflow_handoff_active_execution_seconds(
    generate_entity: WorkflowAppGenerateEntity | AdvancedChatAppGenerateEntity | RagPipelineGenerateEntity,
) -> float:
    if not isinstance(generate_entity, _GenerateEntityExtras):
        return 0.0
    extras = generate_entity.extras
    if extras is None:
        return 0.0
    if not isinstance(extras, dict):
        raise ValueError("Workflow generate entity extras are invalid")
    value = extras.get(WORKFLOW_HANDOFF_ACTIVE_EXECUTION_SECONDS_EXTRA_KEY, 0.0)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("Workflow handoff active execution time is invalid")
    if value < 0:
        raise ValueError("Workflow handoff active execution time must be non-negative")
    return float(value)


# Wrapper types for `WorkflowAppGenerateEntity` and
# `AdvancedChatAppGenerateEntity`. These wrappers enable type discrimination
# and correct reconstruction of the entity field during (de)serialization.
class _WorkflowGenerateEntityWrapper(BaseModel):
    type: Literal[AppMode.WORKFLOW] = AppMode.WORKFLOW
    entity: WorkflowAppGenerateEntity


class _AdvancedChatAppGenerateEntityWrapper(BaseModel):
    type: Literal[AppMode.ADVANCED_CHAT] = AppMode.ADVANCED_CHAT
    entity: AdvancedChatAppGenerateEntity


class _RagPipelineGenerateEntityWrapper(BaseModel):
    type: Literal[AppMode.RAG_PIPELINE] = AppMode.RAG_PIPELINE
    entity: RagPipelineGenerateEntity


type _GenerateEntityUnion = Annotated[
    _WorkflowGenerateEntityWrapper | _AdvancedChatAppGenerateEntityWrapper | _RagPipelineGenerateEntityWrapper,
    Field(discriminator="type"),
]


class WorkflowResumptionContext(BaseModel):
    """WorkflowResumptionContext captures all state necessary for resumption."""

    version: Literal["1"] = "1"

    generate_entity: _GenerateEntityUnion
    serialized_graph_runtime_state: str
    # The graph is reconstructed from the immutable WorkflowRun.graph snapshot,
    # but the active root cannot always be inferred from that graph. Triggered
    # executions may select a non-default root, and single iteration/loop runs
    # intentionally root a filtered graph at the container node.
    #
    # Optional for adjacent-version snapshots created before exact-root handoff
    # support. New maintenance handoffs require this value when they are written.
    root_node_id: str | None = None
    # Optional so that a workflow run paused before this field existed still
    # loads: it just degrades to fresh-filter behavior on resume for that one
    # stale run.
    serialized_response_stream_filter_state: str | None = None
    # Cumulative time spent actively executing before this checkpoint. This is
    # optional for adjacent-version snapshots created before handoff timing was
    # introduced; maintenance wait itself is deliberately not included.
    active_execution_seconds: float = Field(default=0.0, ge=0.0)

    @classmethod
    def from_runtime_snapshot(
        cls,
        *,
        generate_entity: WorkflowAppGenerateEntity | AdvancedChatAppGenerateEntity | RagPipelineGenerateEntity,
        serialized_graph_runtime_state: str,
        serialized_response_stream_filter_state: str | None,
        active_execution_seconds: float = 0.0,
        root_node_id: str | None = None,
    ) -> Self:
        """Build a versioned context shared by user pauses and worker handoffs."""
        entity_wrapper: _GenerateEntityUnion
        # RagPipelineGenerateEntity subclasses WorkflowAppGenerateEntity, so it
        # must be checked first or its dataset/document resume fields are lost.
        if isinstance(generate_entity, RagPipelineGenerateEntity):
            entity_wrapper = _RagPipelineGenerateEntityWrapper(entity=generate_entity)
        elif isinstance(generate_entity, WorkflowAppGenerateEntity):
            entity_wrapper = _WorkflowGenerateEntityWrapper(entity=generate_entity)
        else:
            entity_wrapper = _AdvancedChatAppGenerateEntityWrapper(entity=generate_entity)
        return cls(
            serialized_graph_runtime_state=serialized_graph_runtime_state,
            generate_entity=entity_wrapper,
            serialized_response_stream_filter_state=serialized_response_stream_filter_state,
            active_execution_seconds=active_execution_seconds,
            root_node_id=root_node_id,
        )

    def dumps(self) -> str:
        return self.model_dump_json()

    @classmethod
    def loads(cls, value: str) -> Self:
        return cls.model_validate_json(value)

    def get_generate_entity(
        self,
    ) -> WorkflowAppGenerateEntity | AdvancedChatAppGenerateEntity | RagPipelineGenerateEntity:
        return self.generate_entity.entity

    def get_response_stream_filter(self) -> ResponseStreamFilter:
        response_stream_filter = ResponseStreamFilter()
        if self.serialized_response_stream_filter_state is not None:
            response_stream_filter.loads(self.serialized_response_stream_filter_state)
        return response_stream_filter

    def apply_handoff_execution_timing(self) -> None:
        """Carry cumulative active time into the next segment and checkpoint."""
        self.get_generate_entity().extras[WORKFLOW_HANDOFF_ACTIVE_EXECUTION_SECONDS_EXTRA_KEY] = (
            self.active_execution_seconds
        )


@dataclass(frozen=True)
class PauseStateLayerConfig:
    """Configuration container for instantiating pause persistence layers."""

    session_factory: Engine | sessionmaker[Session]
    state_owner_user_id: str


class PauseStatePersistenceLayer(GraphEngineLayer):
    def __init__(
        self,
        session_factory: Engine | sessionmaker[Session],
        generate_entity: WorkflowAppGenerateEntity | AdvancedChatAppGenerateEntity | RagPipelineGenerateEntity,
        state_owner_user_id: str,
        response_stream_filter: ResponseStreamFilter,
        monotonic_clock: Callable[[], float] = time.monotonic,
    ):
        """Create a PauseStatePersistenceLayer.

        The `state_owner_user_id` is used when creating state file for pause.
        It generally should id of the creator of workflow.

        `response_stream_filter` must be the exact same instance that
        `WorkflowEntry` is using to stream this run's events — this layer
        dumps its state on pause, and a different instance would silently
        persist the wrong (empty) filter state.
        """
        if isinstance(session_factory, Engine):
            session_factory = sessionmaker(session_factory)
        super().__init__()
        self._session_maker = session_factory
        self._state_owner_user_id = state_owner_user_id
        self._generate_entity = generate_entity
        self._response_stream_filter = response_stream_filter
        self._prior_active_execution_seconds = get_workflow_handoff_active_execution_seconds(generate_entity)
        self._monotonic_clock = monotonic_clock
        self._active_segment_started_at: float | None = None
        self._root_node_id: str | None = None

    def set_execution_root_node_id(self, root_node_id: str) -> None:
        if not root_node_id:
            raise ValueError("Workflow pause root node id must not be empty")
        if self._active_segment_started_at is not None:
            raise RuntimeError("Workflow pause root node id cannot change after graph start")
        if self._root_node_id is not None and self._root_node_id != root_node_id:
            raise RuntimeError("Workflow pause root node id was configured more than once")
        self._root_node_id = root_node_id

    def _get_repo(self) -> APIWorkflowRunRepository:
        return DifyAPIRepositoryFactory.create_api_workflow_run_repository(self._session_maker)

    @override
    def on_graph_start(self) -> None:
        """
        Called when graph execution starts.

        This is called after the engine has been initialized but before any nodes
        are executed. Layers can use this to set up resources or log start information.
        """
        self._active_segment_started_at = self._monotonic_clock()

    @override
    def on_event(self, event: GraphEngineEvent) -> None:
        """
        Called for every event emitted by the engine.

        This method receives all events generated during graph execution, including:
        - Graph lifecycle events (start, success, failure)
        - Node execution events (start, success, failure, retry)
        - Stream events for response nodes
        - Container events (iteration, loop)

        Args:
            event: The event emitted by the engine
        """
        if not isinstance(event, GraphRunPausedEvent):
            return
        graph_runtime_state = self.graph_runtime_state
        if is_workflow_warm_shutdown_pause(event.reasons):
            # Planned worker drains use the durable handoff layer. Persisting
            # them here would expose the internal checkpoint as user-visible
            # PAUSED state and make HITL resume semantics race the handoff.
            return

        if self._active_segment_started_at is None:
            raise RuntimeError("Workflow pause layer did not observe graph start")
        segment_execution_seconds = max(
            self._monotonic_clock() - self._active_segment_started_at,
            0.0,
        )

        state = WorkflowResumptionContext.from_runtime_snapshot(
            serialized_graph_runtime_state=graph_runtime_state.dumps(),
            generate_entity=self._generate_entity,
            serialized_response_stream_filter_state=self._response_stream_filter.dumps(),
            active_execution_seconds=self._prior_active_execution_seconds + segment_execution_seconds,
            root_node_id=self._root_node_id,
        )

        workflow_run_id = get_system_text(
            graph_runtime_state.variable_pool,
            SystemVariableKey.WORKFLOW_EXECUTION_ID,
        )
        assert workflow_run_id is not None
        # NOTE(QuantumGhost): Dify owns the pause-reason semantics that cross the
        # persistence boundary. Graphon session ids are translated back to form ids
        # here so repository/model layers only handle Dify-owned pause reasons.
        pause_reasons = enrich_graph_pause_reasons(
            reasons=event.reasons,
            form_repository=HumanInputFormSubmissionRepository(),
            variable_pool=graph_runtime_state.variable_pool,
        )
        repo = self._get_repo()
        repo.create_workflow_pause(
            workflow_run_id=workflow_run_id,
            state_owner_user_id=self._state_owner_user_id,
            state=state.dumps(),
            pause_reasons=pause_reasons,
        )

    @override
    def on_graph_end(self, error: Exception | None) -> None:
        """
        Called when graph execution ends.

        This is called after all nodes have been executed or when execution is
        aborted. Layers can use this to clean up resources or log final state.

        Args:
            error: The exception that caused execution to fail, or None if successful
        """
        pass
