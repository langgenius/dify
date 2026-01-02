import json
import logging
from typing import Annotated, Any, Literal, Self, TypeAlias

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

logger = logging.getLogger(__name__)


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
        """
        Serialize the context to JSON, automatically removing non-serializable fields.

        This method uses a recursive approach to detect and remove non-serializable
        fields instead of relying on hardcoded exclusion paths, making it more
        robust to structural changes.
        """
        data = self.model_dump()
        self._remove_non_serializable(data)
        return json.dumps(data)

    @classmethod
    def _remove_non_serializable(cls, data: Any) -> None:
        """
        Recursively remove non-serializable fields from a data structure.

        This modifies the data structure in-place, removing any values that
        cannot be JSON serialized (e.g., objects with __dict__ that aren't
        BaseModel, dict, list, str, int, float, or bool).

        Args:
            data: The data structure to clean (dict, list, or primitive)
        """
        if isinstance(data, dict):
            keys_to_remove = []
            for key, value in data.items():
                if cls._is_non_serializable(value):
                    keys_to_remove.append(key)
                    logger.debug("Removing non-serializable field: %s", key)
                elif isinstance(value, (dict, list)):
                    cls._remove_non_serializable(value)

            # Remove non-serializable keys
            for key in keys_to_remove:
                del data[key]

        elif isinstance(data, list):
            for item in data:
                if isinstance(item, (dict, list)):
                    cls._remove_non_serializable(item)

    @staticmethod
    def _is_non_serializable(value: Any) -> bool:
        """
        Check if a value is non-serializable for JSON.

        Args:
            value: The value to check

        Returns:
            True if the value cannot be JSON serialized
        """
        # Handle None
        if value is None:
            return False

        # Handle JSON-serializable primitives
        if isinstance(value, (str, int, float, bool)):
            return False

        # Handle collections (needs recursive checking)
        if isinstance(value, (dict, list)):
            return False

        # Handle Pydantic models (have their own serialization)
        if isinstance(value, BaseModel):
            return False

        # Everything else with __dict__ is likely non-serializable
        # (e.g., TraceQueueManager, custom objects, etc.)
        return hasattr(value, "__dict__")

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
        logger.debug("PauseStatePersistenceLayer.on_event called with event type: %s", type(event).__name__)

        if not isinstance(event, GraphRunPausedEvent):
            return

        logger.debug("Processing GraphRunPausedEvent with reasons: %s", event.reasons)

        assert self.graph_runtime_state is not None

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
        logger.debug("Creating workflow pause for workflow_run_id: %s", workflow_run_id)
        assert workflow_run_id is not None
        repo = self._get_repo()
        try:
            repo.create_workflow_pause(
                workflow_run_id=workflow_run_id,
                state_owner_user_id=self._state_owner_user_id,
                state=state.dumps(),
                pause_reasons=event.reasons,
            )
            logger.debug("Successfully created workflow pause for workflow_run_id: %s", workflow_run_id)
        except Exception as e:
            logger.error("Failed to create workflow pause: %s", e, exc_info=True)
            raise

    def on_graph_end(self, error: Exception | None) -> None:
        """
        Called when graph execution ends.

        This is called after all nodes have been executed or when execution is
        aborted. Layers can use this to clean up resources or log final state.

        Args:
            error: The exception that caused execution to fail, or None if successful
        """
        pass
