"""
Workflow Resumption Service

This service provides unified logic for resuming paused workflows,
eliminating code duplication between SSE and Celery contexts.
"""

import logging
from sqlalchemy.orm import sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.layers.pause_state_persist_layer import (
    PauseStatePersistenceLayer,
    WorkflowResumptionContext,
)
from core.workflow.entities import GraphInitParams
from core.workflow.graph import Graph
from core.workflow.graph_engine.command_channels.redis_channel import RedisChannel
from core.workflow.nodes.node_factory import DifyNodeFactory
from core.workflow.runtime import GraphRuntimeState
from core.workflow.workflow_entry import WorkflowEntry
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from models import Workflow, WorkflowPause, WorkflowPauseReason
from models.enums import UserFrom
from sqlalchemy import select

logger = logging.getLogger(__name__)


class WorkflowResumptionService:
    """
    Unified service for resuming paused workflows.

    This service encapsulates the logic for loading pause state,
    restoring the workflow execution context, and preparing the
    workflow for resumption.
    """

    def __init__(self, session_factory: sessionmaker, workflow: Workflow):
        """
        Initialize the resumption service.

        Args:
            session_factory: Database session factory
            workflow: The workflow model to resume
        """
        self._session_factory = session_factory
        self._workflow = workflow

    def load_pause_state(
        self, workflow_run_id: str
    ) -> tuple[WorkflowPause, WorkflowResumptionContext, GraphRuntimeState]:
        """
        Load and parse pause state from database and storage.

        Args:
            workflow_run_id: The workflow run ID to resume

        Returns:
            Tuple of (workflow_pause, resumption_context, graph_runtime_state)

        Raises:
            ValueError: If pause record or state cannot be loaded
        """
        # Load workflow pause record from database
        with self._session_factory() as session:
            workflow_pause = session.execute(
                select(WorkflowPause).where(
                    WorkflowPause.workflow_run_id == workflow_run_id,
                )
            ).scalar_one_or_none()

            if not workflow_pause:
                logger.error("No workflow pause record found for %s", workflow_run_id)
                raise ValueError(f"No workflow pause record found for {workflow_run_id}")

            # Get pause reason for node_id
            pause_reason = session.execute(
                select(WorkflowPauseReason).where(WorkflowPauseReason.pause_id == workflow_pause.id)
            ).scalar_one_or_none()

            state_object_key = workflow_pause.state_object_key

        # Load state from storage
        try:
            state_json = storage.load(state_object_key)
            if isinstance(state_json, bytes):
                state_json = state_json.decode("utf-8")
        except Exception as e:
            logger.exception("Failed to load workflow state for %s", workflow_run_id)
            raise ValueError(f"Failed to load workflow state: {str(e)}")

        # Parse resumption context
        resumption_context = WorkflowResumptionContext.loads(state_json)

        # Restore graph runtime state
        graph_runtime_state = GraphRuntimeState.from_snapshot(
            resumption_context.serialized_graph_runtime_state
        )

        return workflow_pause, resumption_context, graph_runtime_state

    def create_graph_components(
        self,
        resumption_context: WorkflowResumptionContext,
        graph_runtime_state: GraphRuntimeState,
        user_id: str,
    ) -> tuple[Graph, RedisChannel, UserFrom, WorkflowAppGenerateEntity]:
        """
        Create graph components for workflow resumption.

        Args:
            resumption_context: The parsed resumption context
            graph_runtime_state: The restored graph runtime state
            user_id: The user ID who is resuming the workflow

        Returns:
            Tuple of (graph, command_channel, user_from, generate_entity)
        """
        # Get the original generate entity
        generate_entity = resumption_context.get_generate_entity()

        # Determine user_from based on invoke_from
        user_from = (
            UserFrom.ACCOUNT
            if generate_entity.invoke_from in {InvokeFrom.EXPLORE, InvokeFrom.DEBUGGER}
            else UserFrom.END_USER
        )

        # Create graph init params for node factory
        graph_init_params = GraphInitParams(
            tenant_id=self._workflow.tenant_id,
            app_id=self._workflow.app_id,
            workflow_id=self._workflow.id,
            graph_config=self._workflow.graph_dict,
            user_id=user_id,
            user_from=user_from.value,
            invoke_from=generate_entity.invoke_from.value
            if hasattr(generate_entity.invoke_from, "value")
            else generate_entity.invoke_from,
            call_depth=generate_entity.call_depth,
        )

        # Create node factory with the restored graph runtime state
        node_factory = DifyNodeFactory(
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )

        # Initialize graph
        graph = Graph.init(
            graph_config=self._workflow.graph_dict,
            node_factory=node_factory,
        )

        # Create Redis command channel for this workflow execution
        task_id = generate_entity.task_id
        channel_key = f"workflow:{task_id}:commands"
        command_channel = RedisChannel(redis_client, channel_key)

        return graph, command_channel, user_from, generate_entity

    def apply_resume_signal(
        self,
        graph_runtime_state: GraphRuntimeState,
        signal,
    ) -> None:
        """
        Apply resume signal to the variable pool.

        Args:
            graph_runtime_state: The graph runtime state to modify
            signal: The resume signal containing action and reason
        """
        from core.variables import StringSegment

        paused_node_id = signal.paused_node_id

        # Add action (approve/reject) to variable pool for HumanInput node
        graph_runtime_state.variable_pool.add(
            [paused_node_id, "edge_source_handle"],
            StringSegment(value=signal.action)
        )
        graph_runtime_state.variable_pool.add(
            [paused_node_id, "input_ready"],
            StringSegment(value="true")
        )

        # Validate and add reason to variable pool
        reason = signal.reason if (signal.reason and isinstance(signal.reason, str)) else ""
        graph_runtime_state.variable_pool.add(
            [paused_node_id, "reason"],
            StringSegment(value=reason)
        )

        # Ensure the paused node is registered for resumption
        if paused_node_id not in graph_runtime_state._paused_nodes:
            graph_runtime_state.register_paused_node(paused_node_id)

    def create_workflow_entry(
        self,
        graph: Graph,
        command_channel: RedisChannel,
        user_from: UserFrom,
        generate_entity: WorkflowAppGenerateEntity,
        graph_runtime_state: GraphRuntimeState,
        signal,
        add_pause_state_layer: bool = True,
    ) -> WorkflowEntry:
        """
        Create WorkflowEntry for resumption.

        Args:
            graph: The initialized graph
            command_channel: The Redis command channel
            user_from: The user type (ACCOUNT or END_USER)
            generate_entity: The application generate entity
            graph_runtime_state: The graph runtime state
            signal: The resume signal
            add_pause_state_layer: Whether to add PauseStatePersistenceLayer (default True)
                                 Set to False for Celery tasks which use WorkflowResumePersistenceLayer

        Returns:
            Configured WorkflowEntry ready for execution
        """
        # Create workflow entry for resumption
        workflow_entry = WorkflowEntry(
            tenant_id=self._workflow.tenant_id,
            app_id=self._workflow.app_id,
            workflow_id=self._workflow.id,
            graph=graph,
            graph_config=self._workflow.graph_dict,
            user_id=signal.user_id,
            user_from=user_from,
            invoke_from=generate_entity.invoke_from,
            call_depth=generate_entity.call_depth,
            variable_pool=graph_runtime_state.variable_pool,
            graph_runtime_state=graph_runtime_state,
            command_channel=command_channel,
        )

        # Add PauseStatePersistenceLayer to handle pauses during resume
        # This is critical for supporting multiple human-input nodes
        if add_pause_state_layer:
            pause_state_persist_layer = PauseStatePersistenceLayer(
                session_factory=self._session_factory,
                generate_entity=generate_entity,
                state_owner_user_id=signal.user_id,
            )
            workflow_entry.graph_engine.layer(pause_state_persist_layer)

        return workflow_entry
