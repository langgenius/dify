from sqlalchemy import Engine
from sqlalchemy.orm import sessionmaker

from core.workflow.graph_engine.layers.base import GraphEngineLayer
from core.workflow.graph_events.base import GraphEngineEvent
from core.workflow.graph_events.graph import GraphRunPausedEvent
from repositories.api_workflow_run_repository import APIWorkflowRunRepository
from repositories.factory import DifyAPIRepositoryFactory


class PauseStatePersistenceLayer(GraphEngineLayer):
    def __init__(self, session_factory: Engine | sessionmaker, state_owner_user_id: str):
        """Create a PauseStatePersistenceLayer.

        The `state_owner_user_id` is used when creating state file for pause.
        It generally should id of the creator of workflow.
        """
        if isinstance(session_factory, Engine):
            session_factory = sessionmaker(session_factory)
        self._session_maker = session_factory
        self._state_owner_user_id = state_owner_user_id

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

        assert self.graph_runtime_state is not None
        workflow_run_id: str | None = self.graph_runtime_state.system_variable.workflow_execution_id
        assert workflow_run_id is not None
        repo = self._get_repo()
        repo.create_workflow_pause(
            workflow_run_id=workflow_run_id,
            state_owner_user_id=self._state_owner_user_id,
            state=self.graph_runtime_state.dumps(),
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
