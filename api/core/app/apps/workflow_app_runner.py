from collections.abc import Mapping
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
from core.workflow.entities import GraphInitParams, GraphRuntimeState, VariablePool
from core.workflow.graph import Graph
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
from core.workflow.nodes import NodeType
from core.workflow.nodes.node_factory import DifyNodeFactory
from core.workflow.nodes.node_mapping import NODE_TYPE_CLASSES_MAPPING
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
    ) -> None:
        self._queue_manager = queue_manager
        self._variable_loader = variable_loader
        self._app_id = app_id

    def _init_graph(
        self,
        graph_config: Mapping[str, Any],
        graph_runtime_state: GraphRuntimeState,
        workflow_id: str = "",
        tenant_id: str = "",
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
            user_id="",
            user_from=UserFrom.ACCOUNT.value,
            invoke_from=InvokeFrom.SERVICE_API.value,
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

    def _get_graph_and_variable_pool_of_single_iteration(
        self,
        workflow: Workflow,
        node_id: str,
        user_inputs: dict,
        graph_runtime_state: GraphRuntimeState,
    ) -> tuple[Graph, VariablePool]:
        """
        Get variable pool of single iteration
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

        # filter nodes only in iteration
        node_configs = [
            node
            for node in graph_config.get("nodes", [])
            if node.get("id") == node_id or node.get("data", {}).get("iteration_id", "") == node_id
        ]

        graph_config["nodes"] = node_configs

        node_ids = [node.get("id") for node in node_configs]

        # filter edges only in iteration
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
            user_from=UserFrom.ACCOUNT.value,
            invoke_from=InvokeFrom.SERVICE_API.value,
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
        iteration_node_config = None
        for node in node_configs:
            if node.get("id") == node_id:
                iteration_node_config = node
                break

        if not iteration_node_config:
            raise ValueError("iteration node id not found in workflow graph")

        # Get node class
        node_type = NodeType(iteration_node_config.get("data", {}).get("type"))
        node_version = iteration_node_config.get("data", {}).get("version", "1")
        node_cls = NODE_TYPE_CLASSES_MAPPING[node_type][node_version]

        # init variable pool
        variable_pool = VariablePool(
            system_variables=SystemVariable.empty(),
            user_inputs={},
            environment_variables=workflow.environment_variables,
        )

        try:
            variable_mapping = node_cls.extract_variable_selector_to_variable_mapping(
                graph_config=workflow.graph_dict, config=iteration_node_config
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

    def _get_graph_and_variable_pool_of_single_loop(
        self,
        workflow: Workflow,
        node_id: str,
        user_inputs: dict,
        graph_runtime_state: GraphRuntimeState,
    ) -> tuple[Graph, VariablePool]:
        """
        Get variable pool of single loop
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

        # filter nodes only in loop
        node_configs = [
            node
            for node in graph_config.get("nodes", [])
            if node.get("id") == node_id or node.get("data", {}).get("loop_id", "") == node_id
        ]

        graph_config["nodes"] = node_configs

        node_ids = [node.get("id") for node in node_configs]

        # filter edges only in loop
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
            user_from=UserFrom.ACCOUNT.value,
            invoke_from=InvokeFrom.SERVICE_API.value,
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
        loop_node_config = None
        for node in node_configs:
            if node.get("id") == node_id:
                loop_node_config = node
                break

        if not loop_node_config:
            raise ValueError("loop node id not found in workflow graph")

        # Get node class
        node_type = NodeType(loop_node_config.get("data", {}).get("type"))
        node_version = loop_node_config.get("data", {}).get("version", "1")
        node_cls = NODE_TYPE_CLASSES_MAPPING[node_type][node_version]

        # init variable pool
        variable_pool = VariablePool(
            system_variables=SystemVariable.empty(),
            user_inputs={},
            environment_variables=workflow.environment_variables,
        )

        try:
            variable_mapping = node_cls.extract_variable_selector_to_variable_mapping(
                graph_config=workflow.graph_dict, config=loop_node_config
            )
        except NotImplementedError:
            variable_mapping = {}
        load_into_variable_pool(
            self._variable_loader,
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

    def _handle_event(self, workflow_entry: WorkflowEntry, event: GraphEngineEvent) -> None:
        """
        Handle event
        :param workflow_entry: workflow entry
        :param event: event
        """
        if isinstance(event, GraphRunStartedEvent):
            self._publish_event(
                QueueWorkflowStartedEvent(graph_runtime_state=workflow_entry.graph_engine.graph_runtime_state)
            )
        elif isinstance(event, GraphRunSucceededEvent):
            self._publish_event(QueueWorkflowSucceededEvent(outputs=event.outputs))
        elif isinstance(event, GraphRunPartialSucceededEvent):
            self._publish_event(
                QueueWorkflowPartialSuccessEvent(outputs=event.outputs, exceptions_count=event.exceptions_count)
            )
        elif isinstance(event, GraphRunFailedEvent):
            self._publish_event(QueueWorkflowFailedEvent(error=event.error, exceptions_count=event.exceptions_count))
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
                    predecessor_node_id=event.predecessor_node_id,
                    in_iteration_id=event.in_iteration_id,
                    in_loop_id=event.in_loop_id,
                    parallel_mode_run_id=event.parallel_mode_run_id,
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
                    predecessor_node_id=event.predecessor_node_id,
                    in_iteration_id=event.in_iteration_id,
                    in_loop_id=event.in_loop_id,
                    parallel_mode_run_id=event.parallel_mode_run_id,
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
                    text=event.chunk_content,
                    from_variable_selector=event.from_variable_selector,
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
                    predecessor_node_id=event.predecessor_node_id,
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
                    predecessor_node_id=event.predecessor_node_id,
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

    def _publish_event(self, event: AppQueueEvent) -> None:
        self._queue_manager.publish(event, PublishFrom.APPLICATION_MANAGER)
