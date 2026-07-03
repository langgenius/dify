import logging
import time
from collections.abc import Mapping, Sequence
from typing import Any, cast

from pydantic import BaseModel, ConfigDict, ValidationError

from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.entities.agent_strategy import AgentStrategyInfo
from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom, build_dify_run_context
from core.app.entities.queue_entities import (
    AppQueueEvent,
    QueueAgentLogEvent,
    QueueHumanInputFormFilledEvent,
    QueueHumanInputFormTimeoutEvent,
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
    QueueReasoningChunkEvent,
    QueueRetrieverResourcesEvent,
    QueueTextChunkEvent,
    QueueWorkflowFailedEvent,
    QueueWorkflowPartialSuccessEvent,
    QueueWorkflowPausedEvent,
    QueueWorkflowStartedEvent,
    QueueWorkflowSucceededEvent,
)
from core.rag.entities import RetrievalSourceMetadata
from core.repositories.human_input_repository import HumanInputFormSubmissionRepository
from core.workflow.node_factory import (
    DifyGraphInitContext,
    DifyNodeFactory,
    get_default_root_node_id,
    resolve_workflow_node_class,
)
from core.workflow.nodes.human_input.boundary import enrich_graph_pause_reasons
from core.workflow.system_variables import (
    build_bootstrap_variables,
    default_system_variables,
    get_node_creation_preload_selectors,
    inject_default_system_variable_mappings,
    preload_node_creation_variables,
)
from core.workflow.variable_pool_initializer import add_variables_to_pool
from core.workflow.workflow_entry import WorkflowEntry
from core.workflow.workflow_run_outputs import project_node_outputs_for_workflow_run
from graphon.entities.graph_config import NodeConfigDictAdapter
from graphon.entities.graph_config import NodeConfigDictAdapter
from graphon.entities.base_node_data import BaseNodeData
from graphon.entities.graph_config import NodeConfigDict
from graphon.entities.pause_reason import HumanInputRequired
from graphon.graph import Graph
from graphon.graph_engine.layers import GraphEngineLayer
from graphon.graph_events import (
    GraphEngineEvent,
    GraphRunAbortedEvent,
    GraphRunFailedEvent,
    GraphRunPartialSucceededEvent,
    GraphRunPausedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeRunAgentLogEvent,
    NodeRunExceptionEvent,
    NodeRunFailedEvent,
    NodeRunHumanInputFormFilledEvent,
    NodeRunHumanInputFormTimeoutEvent,
    NodeRunIterationFailedEvent,
    NodeRunIterationNextEvent,
    NodeRunIterationStartedEvent,
    NodeRunIterationSucceededEvent,
    NodeRunLoopFailedEvent,
    NodeRunLoopNextEvent,
    NodeRunLoopStartedEvent,
    NodeRunLoopSucceededEvent,
    NodeRunReasoningChunkEvent,
    NodeRunRetrieverResourceEvent,
    NodeRunRetryEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)
from graphon.runtime import GraphRuntimeState, VariablePool
from graphon.variable_loader import DUMMY_VARIABLE_LOADER, VariableLoader, load_into_variable_pool
from models.workflow import Workflow
from tasks.mail_human_input_delivery_task import dispatch_human_input_email_task

logger = logging.getLogger(__name__)


class _WorkflowGraphNodeData(BaseNodeData):
    """Node data fields the runner needs before concrete node validation."""

    start_node_id: str | None = None
    iteration_id: str | None = None
    loop_id: str | None = None

    def parent_id_for(self, key: str) -> str | None:
        match key:
            case "iteration_id":
                return self.iteration_id
            case "loop_id":
                return self.loop_id
            case _:
                return None


class _WorkflowGraphNodeConfig(BaseModel):
    """Top-level node wrapper used for runner graph filtering."""

    id: str
    data: _WorkflowGraphNodeData

    model_config = ConfigDict(extra="allow", strict=True)

    def to_graph_node_config(self) -> dict[str, Any]:
        return {
            **self.model_dump(mode="python", exclude={"data"}, exclude_unset=True),
            "data": self.data.model_dump(mode="python", exclude_unset=True),
        }

    def to_typed_node_config(self) -> NodeConfigDict:
        return cast(NodeConfigDict, {**self.model_dump(mode="python", exclude={"data"}), "data": self.data})


class _WorkflowGraphEdgeConfig(BaseModel):
    """Top-level edge wrapper used for selecting a single-node subgraph."""

    source: str | None = None
    target: str | None = None

    model_config = ConfigDict(extra="allow", strict=True)


class _WorkflowGraphConfig(BaseModel):
    """Validated graph config boundary for runner methods.

    Workflow graph payloads are persisted JSON mappings with extra metadata used
    by graphon, so validation is intentionally limited to the top-level graph
    shape this runner needs before passing the mapping onward.
    """

    nodes: list[_WorkflowGraphNodeConfig]
    edges: list[_WorkflowGraphEdgeConfig]

    model_config = ConfigDict(extra="allow", strict=True)

    def to_graph_config(self) -> dict[str, Any]:
        return self.model_dump(mode="python", exclude_unset=True)


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

    @staticmethod
    def _resolve_user_from(invoke_from: InvokeFrom) -> UserFrom:
        if invoke_from.runs_as_account():
            return UserFrom.ACCOUNT
        return UserFrom.END_USER

    def _init_graph(
        self,
        graph_config: Mapping[str, Any],
        graph_runtime_state: GraphRuntimeState,
        user_from: UserFrom,
        invoke_from: InvokeFrom,
        workflow_id: str = "",
        tenant_id: str = "",
        user_id: str = "",
        root_node_id: str | None = None,
        trace_session_id: str | None = None,
    ) -> Graph:
        """
        Init graph
        """
        graph_config = _WorkflowGraphConfig.model_validate(graph_config).to_graph_config()

        # Create explicit graph init context for Graph.init.
        run_context = build_dify_run_context(
            tenant_id=tenant_id or "",
            app_id=self._app_id,
            user_id=user_id,
            user_from=user_from,
            invoke_from=invoke_from,
            trace_session_id=trace_session_id,
        )
        graph_init_context = DifyGraphInitContext(
            workflow_id=workflow_id,
            graph_config=graph_config,
            run_context=run_context,
            call_depth=0,
        )

        # Use the provided graph_runtime_state for consistent state management

        node_factory = DifyNodeFactory.from_graph_init_context(
            graph_init_context=graph_init_context,
            graph_runtime_state=graph_runtime_state,
        )

        if root_node_id is None:
            root_node_id = get_default_root_node_id(graph_config)

        # init graph
        graph = Graph.init(graph_config=graph_config, node_factory=node_factory, root_node_id=root_node_id)

        if not graph:
            raise ValueError("graph not found in workflow")

        return graph

    def _prepare_single_node_execution(
        self,
        workflow: Workflow,
        single_iteration_run: Any | None = None,
        single_loop_run: Any | None = None,
        *,
        user_id: str,
        trace_session_id: str | None = None,
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
        variable_pool = VariablePool()
        add_variables_to_pool(
            variable_pool,
            build_bootstrap_variables(
                system_variables=default_system_variables(),
                environment_variables=workflow.environment_variables,
            ),
        )
        graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.time())

        # Determine which type of single node execution and get graph/variable_pool
        if single_iteration_run:
            graph, variable_pool = self._get_graph_and_variable_pool_for_single_node_run(
                workflow=workflow,
                node_id=single_iteration_run.node_id,
                user_inputs=dict(single_iteration_run.inputs),
                graph_runtime_state=graph_runtime_state,
                node_type_filter_key="iteration_id",
                node_type_label="iteration",
                user_id=user_id,
                trace_session_id=trace_session_id,
            )
        elif single_loop_run:
            graph, variable_pool = self._get_graph_and_variable_pool_for_single_node_run(
                workflow=workflow,
                node_id=single_loop_run.node_id,
                user_inputs=dict(single_loop_run.inputs),
                graph_runtime_state=graph_runtime_state,
                node_type_filter_key="loop_id",
                node_type_label="loop",
                user_id=user_id,
                trace_session_id=trace_session_id,
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
        *,
        user_id: str = "",
        trace_session_id: str | None = None,
    ) -> tuple[Graph, VariablePool]:
        """
        Get graph and variable pool for single node execution (iteration or loop).
        The workflow graph and user inputs are treated as caller-owned data; the
        narrowed graph config used for execution is built locally.

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
        source_graph_config = _WorkflowGraphConfig.model_validate(workflow.graph_dict)

        node_user_inputs = dict(user_inputs)

        # filter nodes only in the specified node type (iteration or loop)
        main_node_config = next((node for node in source_graph_config.nodes if node.id == node_id), None)
        start_node_id = main_node_config.data.start_node_id if main_node_config else None
        selected_node_configs = [
            node
            for node in source_graph_config.nodes
            if node.id == node_id
            or node.data.parent_id_for(node_type_filter_key) == node_id
            or (start_node_id and node.id == start_node_id)
        ]

        node_ids = [node.id for node in selected_node_configs]

        # filter edges only in the specified node type
        selected_edge_configs = [
            edge
            for edge in source_graph_config.edges
            if (edge.source is None or edge.source in node_ids) and (edge.target is None or edge.target in node_ids)
        ]

        node_configs = [node.to_graph_node_config() for node in selected_node_configs]
        edge_configs = [edge.model_dump(mode="python", exclude_unset=True) for edge in selected_edge_configs]
        graph_config = {
            **source_graph_config.to_graph_config(),
            "nodes": node_configs,
            "edges": edge_configs,
        }

        typed_node_configs = selected_node_configs

        # Create explicit graph init context for Graph.init.
        run_context = build_dify_run_context(
            tenant_id=workflow.tenant_id,
            app_id=self._app_id,
            user_id=user_id,
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.DEBUGGER,
            trace_session_id=trace_session_id,
        )
        graph_init_context = DifyGraphInitContext(
            workflow_id=workflow.id,
            graph_config=graph_config,
            run_context=run_context,
            call_depth=0,
        )

        node_factory = DifyNodeFactory.from_graph_init_context(
            graph_init_context=graph_init_context,
            graph_runtime_state=graph_runtime_state,
        )

        target_node_config = None
        for node in typed_node_configs:
            if node.id == node_id:
                target_node_config = node
                break

        if not target_node_config:
            raise ValueError(f"{node_type_label} node id not found in workflow graph")

        # Get node class
        node_type = target_node_config.data.type
        node_version = str(target_node_config.data.version)
        node_cls = resolve_workflow_node_class(node_type=node_type, node_version=node_version)

        # Use the variable pool from graph_runtime_state instead of creating a new one
        variable_pool = graph_runtime_state.variable_pool

        preload_node_creation_variables(
            variable_loader=self._variable_loader,
            variable_pool=variable_pool,
            selectors=[
                selector
                for node_config in typed_node_configs
                for selector in get_node_creation_preload_selectors(
                    node_type=node_config.data.type,
                    node_data=node_config.data,
                )
            ],
        )

        try:
            variable_mapping = node_cls.extract_variable_selector_to_variable_mapping(
                graph_config=graph_config, config=target_node_config.to_typed_node_config()
            )
        except NotImplementedError:
            variable_mapping = {}
        variable_mapping = inject_default_system_variable_mappings(
            node_id=target_node_config.id,
            node_type=node_type,
            node_data=target_node_config.data,
            variable_mapping=variable_mapping,
        )

        load_into_variable_pool(
            variable_loader=self._variable_loader,
            variable_pool=variable_pool,
            variable_mapping=variable_mapping,
            user_inputs=node_user_inputs,
        )

        WorkflowEntry.mapping_user_inputs_to_variable_pool(
            variable_mapping=variable_mapping,
            user_inputs=node_user_inputs,
            variable_pool=variable_pool,
            tenant_id=workflow.tenant_id,
        )

        # init graph after constructor-time context has been loaded
        graph = Graph.init(
            graph_config=graph_config, node_factory=node_factory, root_node_id=node_id, skip_validation=True
        )

        if not graph:
            raise ValueError("graph not found in workflow")

        return graph, variable_pool

    @staticmethod
    def _build_agent_strategy_info(event: NodeRunStartedEvent) -> AgentStrategyInfo | None:
        raw_agent_strategy = event.extras.get("agent_strategy")
        if raw_agent_strategy is None:
            return None

        try:
            return AgentStrategyInfo.model_validate(raw_agent_strategy)
        except ValidationError:
            logger.warning("Invalid agent strategy payload for node %s", event.node_id, exc_info=True)
            return None

    def _handle_event(self, workflow_entry: WorkflowEntry, event: GraphEngineEvent):
        """
        Handle event
        :param workflow_entry: workflow entry
        :param event: event
        """
        match event:
            case GraphRunStartedEvent():
                self._publish_event(QueueWorkflowStartedEvent(reason=event.reason))
            case GraphRunSucceededEvent():
                self._publish_event(QueueWorkflowSucceededEvent(outputs=event.outputs))
            case GraphRunPartialSucceededEvent():
                self._publish_event(
                    QueueWorkflowPartialSuccessEvent(outputs=event.outputs, exceptions_count=event.exceptions_count)
                )
            case GraphRunFailedEvent():
                self._publish_event(
                    QueueWorkflowFailedEvent(error=event.error, exceptions_count=event.exceptions_count)
                )
            case GraphRunAbortedEvent():
                self._publish_event(QueueWorkflowFailedEvent(error=event.reason or "Unknown error", exceptions_count=0))
            case GraphRunPausedEvent():
                runtime_state = workflow_entry.graph_engine.graph_runtime_state
                paused_nodes = runtime_state.get_paused_nodes()
                enriched_reasons = enrich_graph_pause_reasons(
                    reasons=event.reasons,
                    form_repository=HumanInputFormSubmissionRepository(),
                    variable_pool=runtime_state.variable_pool,
                )
                self._enqueue_human_input_notifications(enriched_reasons)
                self._publish_event(
                    QueueWorkflowPausedEvent(
                        reasons=enriched_reasons,
                        outputs=event.outputs,
                        paused_nodes=paused_nodes,
                    )
                )
            case NodeRunHumanInputFormFilledEvent():
                self._publish_event(
                    QueueHumanInputFormFilledEvent(
                        node_execution_id=event.id,
                        node_id=event.node_id,
                        node_type=event.node_type,
                        node_title=event.node_title,
                        rendered_content=event.rendered_content,
                        action_id=event.action_id,
                        action_text=event.action_text,
                        submitted_data=event.submitted_data,
                    )
                )
            case NodeRunHumanInputFormTimeoutEvent():
                self._publish_event(
                    QueueHumanInputFormTimeoutEvent(
                        node_id=event.node_id,
                        node_type=event.node_type,
                        node_title=event.node_title,
                        expiration_time=event.expiration_time,
                    )
                )
            case NodeRunRetryEvent():
                node_run_result = event.node_run_result
                inputs = node_run_result.inputs
                process_data = node_run_result.process_data
                outputs = project_node_outputs_for_workflow_run(
                    node_type=event.node_type,
                    inputs=inputs,
                    outputs=node_run_result.outputs,
                )
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
            case NodeRunStartedEvent():
                self._publish_event(
                    QueueNodeStartedEvent(
                        node_execution_id=event.id,
                        node_id=event.node_id,
                        node_title=event.node_title,
                        node_type=event.node_type,
                        start_at=event.start_at,
                        in_iteration_id=event.in_iteration_id,
                        in_loop_id=event.in_loop_id,
                        agent_strategy=self._build_agent_strategy_info(event),
                        provider_type=event.provider_type,
                        provider_id=event.provider_id,
                    )
                )
            case NodeRunSucceededEvent():
                node_run_result = event.node_run_result
                inputs = node_run_result.inputs
                process_data = node_run_result.process_data
                outputs = project_node_outputs_for_workflow_run(
                    node_type=event.node_type,
                    inputs=inputs,
                    outputs=node_run_result.outputs,
                )
                execution_metadata = node_run_result.metadata
                self._publish_event(
                    QueueNodeSucceededEvent(
                        node_execution_id=event.id,
                        node_id=event.node_id,
                        node_type=event.node_type,
                        start_at=event.start_at,
                        finished_at=event.finished_at,
                        inputs=inputs,
                        process_data=process_data,
                        outputs=outputs,
                        execution_metadata=execution_metadata,
                        in_iteration_id=event.in_iteration_id,
                        in_loop_id=event.in_loop_id,
                    )
                )
            case NodeRunFailedEvent():
                outputs = project_node_outputs_for_workflow_run(
                    node_type=event.node_type,
                    inputs=event.node_run_result.inputs,
                    outputs=event.node_run_result.outputs,
                )
                self._publish_event(
                    QueueNodeFailedEvent(
                        node_execution_id=event.id,
                        node_id=event.node_id,
                        node_type=event.node_type,
                        start_at=event.start_at,
                        finished_at=event.finished_at,
                        inputs=event.node_run_result.inputs,
                        process_data=event.node_run_result.process_data,
                        outputs=outputs,
                        error=event.node_run_result.error or "Unknown error",
                        execution_metadata=event.node_run_result.metadata,
                        in_iteration_id=event.in_iteration_id,
                        in_loop_id=event.in_loop_id,
                    )
                )
            case NodeRunExceptionEvent():
                outputs = project_node_outputs_for_workflow_run(
                    node_type=event.node_type,
                    inputs=event.node_run_result.inputs,
                    outputs=event.node_run_result.outputs,
                )
                self._publish_event(
                    QueueNodeExceptionEvent(
                        node_execution_id=event.id,
                        node_id=event.node_id,
                        node_type=event.node_type,
                        start_at=event.start_at,
                        finished_at=event.finished_at,
                        inputs=event.node_run_result.inputs,
                        process_data=event.node_run_result.process_data,
                        outputs=outputs,
                        error=event.node_run_result.error or "Unknown error",
                        execution_metadata=event.node_run_result.metadata,
                        in_iteration_id=event.in_iteration_id,
                        in_loop_id=event.in_loop_id,
                    )
                )
            case NodeRunStreamChunkEvent():
                self._publish_event(
                    QueueTextChunkEvent(
                        text=event.chunk,
                        from_variable_selector=list(event.selector),
                        in_iteration_id=event.in_iteration_id,
                        in_loop_id=event.in_loop_id,
                    )
                )
            case NodeRunReasoningChunkEvent():
                self._publish_event(
                    QueueReasoningChunkEvent(
                        reasoning=event.chunk,
                        from_node_id=event.node_id,
                        is_final=event.is_final,
                        in_iteration_id=event.in_iteration_id,
                        in_loop_id=event.in_loop_id,
                    )
                )
            case NodeRunRetrieverResourceEvent():
                self._publish_event(
                    QueueRetrieverResourcesEvent(
                        retriever_resources=[
                            RetrievalSourceMetadata.model_validate(resource) for resource in event.retriever_resources
                        ],
                        in_iteration_id=event.in_iteration_id,
                        in_loop_id=event.in_loop_id,
                    )
                )
            case NodeRunAgentLogEvent():
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
            case NodeRunIterationStartedEvent():
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
            case NodeRunIterationNextEvent():
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
            case NodeRunIterationSucceededEvent() | NodeRunIterationFailedEvent():
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
            case NodeRunLoopStartedEvent():
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
            case NodeRunLoopNextEvent():
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
            case NodeRunLoopSucceededEvent() | NodeRunLoopFailedEvent():
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

    def _enqueue_human_input_notifications(self, reasons: Sequence[object]) -> None:
        for reason in reasons:
            if not isinstance(reason, HumanInputRequired):
                continue
            if not reason.form_id:
                continue
            try:
                dispatch_human_input_email_task.apply_async(
                    kwargs={"form_id": reason.form_id, "node_title": reason.node_title},
                    queue="mail",
                )
            except Exception:  # pragma: no cover - defensive logging
                logger.exception("Failed to enqueue human input email task for form %s", reason.form_id)

    def _publish_event(self, event: AppQueueEvent):
        self._queue_manager.publish(event, PublishFrom.APPLICATION_MANAGER)
