from dataclasses import dataclass
from typing import Annotated, Literal, Self, override

from pydantic import BaseModel, Field
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, WorkflowAppGenerateEntity
from core.repositories.human_input_repository import HumanInputFormSubmissionRepository
from core.workflow.nodes.human_input.boundary import enrich_graph_pause_reasons
from core.workflow.system_variables import SystemVariableKey, get_system_text
from graphon.filters import ResponseStreamFilter
from graphon.graph_engine.layers import GraphEngineLayer
from graphon.graph_events import GraphEngineEvent, GraphRunPausedEvent
from models.model import AppMode
from repositories.api_workflow_run_repository import APIWorkflowRunRepository
from repositories.factory import DifyAPIRepositoryFactory


# Wrapper types for `WorkflowAppGenerateEntity` and
# `AdvancedChatAppGenerateEntity`. These wrappers enable type discrimination
# and correct reconstruction of the entity field during (de)serialization.
class _WorkflowGenerateEntityWrapper(BaseModel):
    type: Literal[AppMode.WORKFLOW] = AppMode.WORKFLOW
    entity: WorkflowAppGenerateEntity


class _AdvancedChatAppGenerateEntityWrapper(BaseModel):
    type: Literal[AppMode.ADVANCED_CHAT] = AppMode.ADVANCED_CHAT
    entity: AdvancedChatAppGenerateEntity


type _GenerateEntityUnion = Annotated[
    _WorkflowGenerateEntityWrapper | _AdvancedChatAppGenerateEntityWrapper,
    Field(discriminator="type"),
]


class WorkflowResumptionContext(BaseModel):
    """WorkflowResumptionContext captures all state necessary for resumption."""

    version: Literal["1"] = "1"

    # Only workflow / chatflow could be paused.
    generate_entity: _GenerateEntityUnion
    serialized_graph_runtime_state: str
    # Optional so that a workflow run paused before this field existed still
    # loads: it just degrades to fresh-filter behavior on resume for that one
    # stale run.
    serialized_response_stream_filter_state: str | None = None

    def dumps(self) -> str:
        return self.model_dump_json()

    @classmethod
    def loads(cls, value: str) -> Self:
        return cls.model_validate_json(value)

    def get_generate_entity(self) -> WorkflowAppGenerateEntity | AdvancedChatAppGenerateEntity:
        return self.generate_entity.entity

    def get_response_stream_filter(self) -> ResponseStreamFilter:
        response_stream_filter = ResponseStreamFilter()
        if self.serialized_response_stream_filter_state is not None:
            response_stream_filter.loads(self.serialized_response_stream_filter_state)
        return response_stream_filter


@dataclass(frozen=True)
class PauseStateLayerConfig:
    """Configuration container for instantiating pause persistence layers."""

    session_factory: Engine | sessionmaker[Session]
    state_owner_user_id: str


class PauseStatePersistenceLayer(GraphEngineLayer):
    def __init__(
        self,
        session_factory: Engine | sessionmaker[Session],
        generate_entity: WorkflowAppGenerateEntity | AdvancedChatAppGenerateEntity,
        state_owner_user_id: str,
        response_stream_filter: ResponseStreamFilter,
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

    def _get_repo(self) -> APIWorkflowRunRepository:
        return DifyAPIRepositoryFactory.create_api_workflow_run_repository(self._session_maker)

    @override
    def on_graph_start(self) -> None:
        """
        Called when graph execution starts.

        This is called after the engine has been initialized but before any nodes
        are executed. Layers can use this to set up resources or log start information.
        """
        pass

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

        entity_wrapper: _GenerateEntityUnion
        if isinstance(self._generate_entity, WorkflowAppGenerateEntity):
            entity_wrapper = _WorkflowGenerateEntityWrapper(entity=self._generate_entity)
        else:
            entity_wrapper = _AdvancedChatAppGenerateEntityWrapper(entity=self._generate_entity)

        state = WorkflowResumptionContext(
            serialized_graph_runtime_state=self.graph_runtime_state.dumps(),
            generate_entity=entity_wrapper,
            serialized_response_stream_filter_state=self._response_stream_filter.dumps(),
        )

        workflow_run_id = get_system_text(
            self.graph_runtime_state.variable_pool,
            SystemVariableKey.WORKFLOW_EXECUTION_ID,
        )
        assert workflow_run_id is not None
        # NOTE(QuantumGhost): Dify owns the pause-reason semantics that cross the
        # persistence boundary. Graphon session ids are translated back to form ids
        # here so repository/model layers only handle Dify-owned pause reasons.
        pause_reasons = enrich_graph_pause_reasons(
            reasons=event.reasons,
            form_repository=HumanInputFormSubmissionRepository(),
            variable_pool=self.graph_runtime_state.variable_pool,
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
