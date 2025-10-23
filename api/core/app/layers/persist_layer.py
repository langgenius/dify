from core.workflow.graph_engine.layers.base import GraphEngineLayer
from core.workflow.graph_engine.protocols.command_channel import CommandChannel
from core.workflow.graph_events.base import GraphEngineEvent
from core.workflow.graph_events.graph import GraphRunPausedEvent
from core.workflow.runtime.graph_runtime_state_protocol import ReadOnlyGraphRuntimeState
from models.workflow import Workflow, WorkflowRun
from services.workflow_run_service import WorkflowRunService


class PauseStatePersistenceLayer(GraphEngineLayer):
    def __init__(self, workflow_run_service: WorkflowRunService, workflow_run: WorkflowRun, workflow: Workflow):
        self._workflow_run_service = workflow_run_service
        self._workflow_run = workflow_run
        self._workflow = workflow

    def initialize(self, graph_runtime_state: ReadOnlyGraphRuntimeState, command_channel: CommandChannel) -> None:
        """
        Initialize the layer with engine dependencies.

        Called by GraphEngine before execution starts to inject the read-only runtime state
        and command channel. This allows layers to observe engine context and send
        commands, but prevents direct state modification.

        Args:
            graph_runtime_state: Read-only view of the runtime state
            command_channel: Channel for sending commands to the engine
        """
        self.graph_runtime_state = graph_runtime_state
        self.command_channel = command_channel

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
        self._workflow_run_service.save_pause_state(
            self._workflow_run,
            state_owner_user_id=self._workflow.created_by,
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
