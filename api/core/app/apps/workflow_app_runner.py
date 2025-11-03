import time
from collections.abc import Mapping, Sequence
from typing import Any, cast

from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.queue_entities import (
    AppQueueEvent,
    QueueAgentLogEvent,
    QueueIterationCompletedEvent,
    QueueIterationNextEvent,
    QueueIterationStartEvent,
    QueueLoopCompletedEvent,
    QueueLoopNextEvent,
    QueueLoopStartEvent,
    QueueNodeExceptionEvent,
    QueueNodeFailedEvent,
    QueueNodeRetryEvent,
    QueueNodeStartedEvent,
    QueueNodeSucceededEvent,
    QueueRetrieverResourcesEvent,
    QueueTextChunkEvent,
    QueueWorkflowFailedEvent,
    QueueWorkflowPartialSuccessEvent,
    QueueWorkflowStartedEvent,
    QueueWorkflowSucceededEvent,
)
from core.workflow.entities import GraphInitParams
from core.workflow.graph import Graph
from core.workflow.graph_engine.layers.base import GraphEngineLayer
from core.workflow.graph_events import (
    GraphEngineEvent,
    GraphRunFailedEvent,
    GraphRunPartialSucceededEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeRunAgentLogEvent,
    NodeRunExceptionEvent,
    NodeRunFailedEvent,
    NodeRunIterationFailedEvent,
    NodeRunIterationNextEvent,
    NodeRunIterationStartedEvent,
    NodeRunIterationSucceededEvent,
    NodeRunLoopFailedEvent,
    NodeRunLoopNextEvent,
    NodeRunLoopStartedEvent,
    NodeRunLoopSucceededEvent,
    NodeRunRetrieverResourceEvent,
    NodeRunRetryEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)
from core.workflow.graph_events.graph import GraphRunAbortedEvent
from core.workflow.nodes import NodeType
from core.workflow.nodes.node_factory import DifyNodeFactory
from core.workflow.nodes.node_mapping import NODE_TYPE_CLASSES_MAPPING
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable
from core.workflow.variable_loader import DUMMY_VARIABLE_LOADER, VariableLoader, load_into_variable_pool
from core.workflow.workflow_entry import WorkflowEntry
from models.enums import UserFrom
from models.workflow import Workflow


class WorkflowBasedAppRunner:
    def __init__(
        self,
        *,
        queue_manager: AppQueueManager,
        variable_loader: VariableLoader = DUMMY_VARIABLE_LOADER,
        app_id: str,
        graph_engine_layers: Sequence[GraphEngineLayer] = (),
    ):
        self._queue_manager = queue_manager
        self._variable_loader = variable_loader
        self._app_id = app_id
        self._graph_engine_layers = graph_engine_layers

    def _init_graph(
        self,
        graph_config: Mapping[str, Any],
        graph_runtime_state: GraphRuntimeState,
        workflow_id: str = "",
        tenant_id: str = "",
        user_id: str = "",
    ) -> Graph:
        """
        Init graph
        """
        if "nodes" not in graph_config or "edges" not in graph_config:
            raise ValueError("nodes or edges not found in workflow graph")

        if not isinstance(graph_config.get("nodes"), list):
            raise ValueError("nodes in workflow graph must be a list")

        if not isinstance(graph_config.get("edges"), list):
            raise ValueError("edges in workflow graph must be a list")

        # Create required parameters for Graph.init
        graph_init_params = GraphInitParams(
            tenant_id=tenant_id or "",
            app_id=self._app_id,
            workflow_id=workflow_id,
            graph_config=graph_config,
            user_id=user_id,
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.SERVICE_API,
            call_depth=0,
        )

        # Use the provided graph_runtime_state for consistent state management

        node_factory = DifyNodeFactory(
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )

        # init graph
        graph = Graph.init(graph_config=graph_config, node_factory=node_factory)

        if not graph:
            raise ValueError("graph not found in workflow")

        return graph

    def _prepare_single_node_execution(
        self,
        workflow: Workflow,
        single_iteration_run: Any | None = None,
        single_loop_run: Any | None = None,
    ) -> tuple[Graph, VariablePool, GraphRuntimeState]:
        """
        Prepare graph, variable pool, and runtime state for single node execution
        (either single iteration or single loop).

        Args:
            workflow: The workflow instance
            single_iteration_run: SingleIterationRunEntity if running single iteration, None otherwise
            single_loop_run: SingleLoopRunEntity if running single loop, None otherwise

        Returns:
            A tuple containing (graph, variable_pool, graph_runtime_state)

        Raises:
            ValueError: If neither single_iteration_run nor single_loop_run is specified
        """
        # Create initial runtime state with variable pool containing environment variables
        graph_runtime_state = GraphRuntimeState(
            variable_pool=VariablePool(
                system_variables=SystemVariable.empty(),
                user_inputs={},
                environment_variables=workflow.environment_variables,
            ),
            start_at=time.time(),
        )

        # Determine which type of single node execution and get graph/variable_pool
        if single_iteration_run:
            graph, variable_pool = self._get_graph_and_variable_pool_of_single_iteration(
                workflow=workflow,
                node_id=single_iteration_run.node_id,
                user_inputs=dict(single_iteration_run.inputs),
                graph_runtime_state=graph_runtime_state,
            )
        elif single_loop_run:
            graph, variable_pool = self._get_graph_and_variable_pool_of_single_loop(
                workflow=workflow,
                node_id=single_loop_run.node_id,
                user_inputs=dict(single_loop_run.inputs),
                graph_runtime_state=graph_runtime_state,
            )
        else:
            raise ValueError("Neither single_iteration_run nor single_loop_run is specified")

        # Return the graph, variable_pool, and the same graph_runtime_state used during graph creation
        # This ensures all nodes in the graph reference the same GraphRuntimeState instance
        return graph, variable_pool, graph_runtime_state

    def _get_graph_and_variable_pool_for_single_node_run(
        self,
        workflow: Workflow,
        node_id: str,
        user_inputs: dict[str, Any],
        graph_runtime_state: GraphRuntimeState,
        node_type_filter_key: str,  # 'iteration_id' or 'loop_id'
        node_type_label: str = "node",  # 'iteration' or 'loop' for error messages
    ) -> tuple[Graph, VariablePool]:
        """
        Get graph and variable pool for single node execution (iteration or loop).

        Args:
            workflow: The workflow instance
            node_id: The node ID to execute
            user_inputs: User inputs for the node
            graph_runtime_state: The graph runtime state
            node_type_filter_key: The key to filter nodes ('iteration_id' or 'loop_id')
            node_type_label: Label for error messages ('iteration' or 'loop')

        Returns:
            A tuple containing (graph, variable_pool)
        """
        # fetch workflow graph
        graph_config = workflow.graph_dict
        if not graph_config:
            raise ValueError("workflow graph not found")

        graph_config = cast(dict[str, Any], graph_config)

        if "nodes" not in graph_config or "edges" not in graph_config:
            raise ValueError("nodes or edges not found in workflow graph")

        if not isinstance(graph_config.get("nodes"), list):
            raise ValueError("nodes in workflow graph must be a list")

        if not isinstance(graph_config.get("edges"), list):
            raise ValueError("edges in workflow graph must be a list")

        # filter nodes only in the specified node type (iteration or loop)
        main_node_config = next((n for n in graph_config.get("nodes", []) if n.get("id") == node_id), None)
        start_node_id = main_node_config.get("data", {}).get("start_node_id") if main_node_config else None
        node_configs = [
            node
            for node in graph_config.get("nodes", [])
            if node.get("id") == node_id
            or node.get("data", {}).get(node_type_filter_key, "") == node_id
            or (start_node_id and node.get("id") == start_node_id)
        ]

        graph_config["nodes"] = node_configs

        node_ids = [node.get("id") for node in node_configs]

        # filter edges only in the specified node type
        edge_configs = [
            edge
            for edge in graph_config.get("edges", [])
            if (edge.get("source") is None or edge.get("source") in node_ids)
            and (edge.get("target") is None or edge.get("target") in node_ids)
        ]

        graph_config["edges"] = edge_configs

        # Create required parameters for Graph.init
        graph_init_params = GraphInitParams(
            tenant_id=workflow.tenant_id,
            app_id=self._app_id,
            workflow_id=workflow.id,
            graph_config=graph_config,
            user_id="",
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.SERVICE_API,
            call_depth=0,
        )

        node_factory = DifyNodeFactory(
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )

        # init graph
        graph = Graph.init(graph_config=graph_config, node_factory=node_factory, root_node_id=node_id)

        if not graph:
            raise ValueError("graph not found in workflow")

        # fetch node config from node id
        target_node_config = None
        for node in node_configs:
            if node.get("id") == node_id:
                target_node_config = node
                break

        if not target_node_config:
            raise ValueError(f"{node_type_label} node id not found in workflow graph")

        # Get node class
        node_type = NodeType(target_node_config.get("data", {}).get("type"))
        node_version = target_node_config.get("data", {}).get("version", "1")
        node_cls = NODE_TYPE_CLASSES_MAPPING[node_type][node_version]

        # Use the variable pool from graph_runtime_state instead of creating a new one
        variable_pool = graph_runtime_state.variable_pool

        try:
            variable_mapping = node_cls.extract_variable_selector_to_variable_mapping(
                graph_config=workflow.graph_dict, config=target_node_config
            )
        except NotImplementedError:
            variable_mapping = {}

        load_into_variable_pool(
            variable_loader=self._variable_loader,
            variable_pool=variable_pool,
            variable_mapping=variable_mapping,
            user_inputs=user_inputs,
        )

        WorkflowEntry.mapping_user_inputs_to_variable_pool(
            variable_mapping=variable_mapping,
            user_inputs=user_inputs,
            variable_pool=variable_pool,
            tenant_id=workflow.tenant_id,
        )

        return graph, variable_pool

    def _get_graph_and_variable_pool_of_single_iteration(
        self,
        workflow: Workflow,
        node_id: str,
        user_inputs: dict[str, Any],
        graph_runtime_state: GraphRuntimeState,
    ) -> tuple[Graph, VariablePool]:
        """
        Get variable pool of single iteration
        """
        return self._get_graph_and_variable_pool_for_single_node_run(
            workflow=workflow,
            node_id=node_id,
            user_inputs=user_inputs,
            graph_runtime_state=graph_runtime_state,
            node_type_filter_key="iteration_id",
            node_type_label="iteration",
        )

    def _get_graph_and_variable_pool_of_single_loop(
        self,
        workflow: Workflow,
        node_id: str,
        user_inputs: dict[str, Any],
        graph_runtime_state: GraphRuntimeState,
    ) -> tuple[Graph, VariablePool]:
        """
        Get variable pool of single loop
        """
        return self._get_graph_and_variable_pool_for_single_node_run(
            workflow=workflow,
            node_id=node_id,
            user_inputs=user_inputs,
            graph_runtime_state=graph_runtime_state,
            node_type_filter_key="loop_id",
            node_type_label="loop",
        )

    def _handle_event(self, workflow_entry: WorkflowEntry, event: GraphEngineEvent):
        """
        Handle event
        :param workflow_entry: workflow entry
        :param event: event
        """
        if isinstance(event, GraphRunStartedEvent):
            self._publish_event(QueueWorkflowStartedEvent())
        elif isinstance(event, GraphRunSucceededEvent):
            self._publish_event(QueueWorkflowSucceededEvent(outputs=event.outputs))
        elif isinstance(event, GraphRunPartialSucceededEvent):
            self._publish_event(
                QueueWorkflowPartialSuccessEvent(outputs=event.outputs, exceptions_count=event.exceptions_count)
            )
        elif isinstance(event, GraphRunFailedEvent):
            self._publish_event(QueueWorkflowFailedEvent(error=event.error, exceptions_count=event.exceptions_count))
        elif isinstance(event, GraphRunAbortedEvent):
            self._publish_event(QueueWorkflowFailedEvent(error=event.reason or "Unknown error", exceptions_count=0))
        elif isinstance(event, NodeRunRetryEvent):
            node_run_result = event.node_run_result
            inputs = node_run_result.inputs
            process_data = node_run_result.process_data
            outputs = node_run_result.outputs
            execution_metadata = node_run_result.metadata
            self._publish_event(
                QueueNodeRetryEvent(
                    node_execution_id=event.id,
                    node_id=event.node_id,
                    node_title=event.node_title,
                    node_type=event.node_type,
                    start_at=event.start_at,
                    in_iteration_id=event.in_iteration_id,
                    in_loop_id=event.in_loop_id,
                    inputs=inputs,
                    process_data=process_data,
                    outputs=outputs,
                    error=event.error,
                    execution_metadata=execution_metadata,
                    retry_index=event.retry_index,
                    provider_type=event.provider_type,
                    provider_id=event.provider_id,
                )
            )
        elif isinstance(event, NodeRunStartedEvent):
            self._publish_event(
                QueueNodeStartedEvent(
                    node_execution_id=event.id,
                    node_id=event.node_id,
                    node_title=event.node_title,
                    node_type=event.node_type,
                    start_at=event.start_at,
                    in_iteration_id=event.in_iteration_id,
                    in_loop_id=event.in_loop_id,
                    agent_strategy=event.agent_strategy,
                    provider_type=event.provider_type,
                    provider_id=event.provider_id,
                )
            )
        elif isinstance(event, NodeRunSucceededEvent):
            node_run_result = event.node_run_result
            inputs = node_run_result.inputs
            process_data = node_run_result.process_data
            outputs = node_run_result.outputs
            execution_metadata = node_run_result.metadata
            self._publish_event(
                QueueNodeSucceededEvent(
                    node_execution_id=event.id,
                    node_id=event.node_id,
                    node_type=event.node_type,
                    start_at=event.start_at,
                    inputs=inputs,
                    process_data=process_data,
                    outputs=outputs,
                    execution_metadata=execution_metadata,
                    in_iteration_id=event.in_iteration_id,
                    in_loop_id=event.in_loop_id,
                )
            )
        elif isinstance(event, NodeRunFailedEvent):
            self._publish_event(
                QueueNodeFailedEvent(
                    node_execution_id=event.id,
                    node_id=event.node_id,
                    node_type=event.node_type,
                    start_at=event.start_at,
                    inputs=event.node_run_result.inputs,
                    process_data=event.node_run_result.process_data,
                    outputs=event.node_run_result.outputs,
                    error=event.node_run_result.error or "Unknown error",
                    execution_metadata=event.node_run_result.metadata,
                    in_iteration_id=event.in_iteration_id,
                    in_loop_id=event.in_loop_id,
                )
            )
        elif isinstance(event, NodeRunExceptionEvent):
            self._publish_event(
                QueueNodeExceptionEvent(
                    node_execution_id=event.id,
                    node_id=event.node_id,
                    node_type=event.node_type,
                    start_at=event.start_at,
                    inputs=event.node_run_result.inputs,
                    process_data=event.node_run_result.process_data,
                    outputs=event.node_run_result.outputs,
                    error=event.node_run_result.error or "Unknown error",
                    execution_metadata=event.node_run_result.metadata,
                    in_iteration_id=event.in_iteration_id,
                    in_loop_id=event.in_loop_id,
                )
            )
        elif isinstance(event, NodeRunStreamChunkEvent):
            self._publish_event(
                QueueTextChunkEvent(
                    text=event.chunk,
                    from_variable_selector=list(event.selector),
                    in_iteration_id=event.in_iteration_id,
                    in_loop_id=event.in_loop_id,
                )
            )
        elif isinstance(event, NodeRunRetrieverResourceEvent):
            self._publish_event(
                QueueRetrieverResourcesEvent(
                    retriever_resources=event.retriever_resources,
                    in_iteration_id=event.in_iteration_id,
                    in_loop_id=event.in_loop_id,
                )
            )
        elif isinstance(event, NodeRunAgentLogEvent):
            self._publish_event(
                QueueAgentLogEvent(
                    id=event.message_id,
                    label=event.label,
                    node_execution_id=event.node_execution_id,
                    parent_id=event.parent_id,
                    error=event.error,
                    status=event.status,
                    data=event.data,
                    metadata=event.metadata,
                    node_id=event.node_id,
                )
            )
        elif isinstance(event, NodeRunIterationStartedEvent):
            self._publish_event(
                QueueIterationStartEvent(
                    node_execution_id=event.id,
                    node_id=event.node_id,
                    node_type=event.node_type,
                    node_title=event.node_title,
                    start_at=event.start_at,
                    node_run_index=workflow_entry.graph_engine.graph_runtime_state.node_run_steps,
                    inputs=event.inputs,
                    metadata=event.metadata,
                )
            )
        elif isinstance(event, NodeRunIterationNextEvent):
            self._publish_event(
                QueueIterationNextEvent(
                    node_execution_id=event.id,
                    node_id=event.node_id,
                    node_type=event.node_type,
                    node_title=event.node_title,
                    index=event.index,
                    node_run_index=workflow_entry.graph_engine.graph_runtime_state.node_run_steps,
                    output=event.pre_iteration_output,
                )
            )
        elif isinstance(event, (NodeRunIterationSucceededEvent | NodeRunIterationFailedEvent)):
            self._publish_event(
                QueueIterationCompletedEvent(
                    node_execution_id=event.id,
                    node_id=event.node_id,
                    node_type=event.node_type,
                    node_title=event.node_title,
                    start_at=event.start_at,
                    node_run_index=workflow_entry.graph_engine.graph_runtime_state.node_run_steps,
                    inputs=event.inputs,
                    outputs=event.outputs,
                    metadata=event.metadata,
                    steps=event.steps,
                    error=event.error if isinstance(event, NodeRunIterationFailedEvent) else None,
                )
            )
        elif isinstance(event, NodeRunLoopStartedEvent):
            self._publish_event(
                QueueLoopStartEvent(
                    node_execution_id=event.id,
                    node_id=event.node_id,
                    node_type=event.node_type,
                    node_title=event.node_title,
                    start_at=event.start_at,
                    node_run_index=workflow_entry.graph_engine.graph_runtime_state.node_run_steps,
                    inputs=event.inputs,
                    metadata=event.metadata,
                )
            )
        elif isinstance(event, NodeRunLoopNextEvent):
            self._publish_event(
                QueueLoopNextEvent(
                    node_execution_id=event.id,
                    node_id=event.node_id,
                    node_type=event.node_type,
                    node_title=event.node_title,
                    index=event.index,
                    node_run_index=workflow_entry.graph_engine.graph_runtime_state.node_run_steps,
                    output=event.pre_loop_output,
                )
            )
        elif isinstance(event, (NodeRunLoopSucceededEvent | NodeRunLoopFailedEvent)):
            self._publish_event(
                QueueLoopCompletedEvent(
                    node_execution_id=event.id,
                    node_id=event.node_id,
                    node_type=event.node_type,
                    node_title=event.node_title,
                    start_at=event.start_at,
                    node_run_index=workflow_entry.graph_engine.graph_runtime_state.node_run_steps,
                    inputs=event.inputs,
                    outputs=event.outputs,
                    metadata=event.metadata,
                    steps=event.steps,
                    error=event.error if isinstance(event, NodeRunLoopFailedEvent) else None,
                )
            )

    def _publish_event(self, event: AppQueueEvent):
        self._queue_manager.publish(event, PublishFrom.APPLICATION_MANAGER)
