from typing import Annotated, Literal, Self, TypeAlias

from pydantic import BaseModel, Field
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, WorkflowAppGenerateEntity
from core.workflow.graph_engine.layers.base import GraphEngineLayer
from core.workflow.graph_events.base import GraphEngineEvent
from core.workflow.graph_events.graph import GraphRunPausedEvent
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


_GenerateEntityUnion: TypeAlias = Annotated[
    _WorkflowGenerateEntityWrapper | _AdvancedChatAppGenerateEntityWrapper,
    Field(discriminator="type"),
]


class WorkflowResumptionContext(BaseModel):
    """WorkflowResumptionContext captures all state necessary for resumption."""

    version: Literal["1"] = "1"

    # Only workflow / chatflow could be paused.
    generate_entity: _GenerateEntityUnion
    serialized_graph_runtime_state: str

    def dumps(self) -> str:
        return self.model_dump_json()

    @classmethod
    def loads(cls, value: str) -> Self:
        return cls.model_validate_json(value)

    def get_generate_entity(self) -> WorkflowAppGenerateEntity | AdvancedChatAppGenerateEntity:
        return self.generate_entity.entity


class PauseStatePersistenceLayer(GraphEngineLayer):
    def __init__(
        self,
        session_factory: Engine | sessionmaker[Session],
        generate_entity: WorkflowAppGenerateEntity | AdvancedChatAppGenerateEntity,
        state_owner_user_id: str,
    ):
        """Create a PauseStatePersistenceLayer.

        The `state_owner_user_id` is used when creating state file for pause.
        It generally should id of the creator of workflow.
        """
        if isinstance(session_factory, Engine):
            session_factory = sessionmaker(session_factory)
        super().__init__()
        self._session_maker = session_factory
        self._state_owner_user_id = state_owner_user_id
        self._generate_entity = generate_entity

    def _get_repo(self) -> APIWorkflowRunRepository:
        return DifyAPIRepositoryFactory.create_api_workflow_run_repository(self._session_maker)

    def on_graph_start(self) -> None:
        """
        Called when graph execution starts.

        This is called after the engine has been initialized but before any nodes
        are executed. Layers can use this to set up resources or log start information.
        """
        pass

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
        )

        workflow_run_id: str | None = self.graph_runtime_state.system_variable.workflow_execution_id
        assert workflow_run_id is not None
        repo = self._get_repo()
        repo.create_workflow_pause(
            workflow_run_id=workflow_run_id,
            state_owner_user_id=self._state_owner_user_id,
            state=state.dumps(),
            pause_reasons=event.reasons,
        )

    def on_graph_end(self, error: Exception | None) -> None:
        """
        Called when graph execution ends.

        This is called after all nodes have been executed or when execution is
        aborted. Layers can use this to clean up resources or log final state.

        Args:
            error: The exception that caused execution to fail, or None if successful
        """
        pass
