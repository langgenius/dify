import contextvars
import logging
import queue
import time
import uuid
from collections.abc import Generator, Mapping
from concurrent.futures import ThreadPoolExecutor, wait
from copy import copy, deepcopy
from datetime import UTC, datetime
from typing import Any, Optional, cast

from flask import Flask, current_app

from configs import dify_config
from core.app.apps.base_app_queue_manager import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities.node_entities import AgentNodeStrategyInit, NodeRunResult
from core.workflow.entities.variable_pool import VariablePool, VariableValue
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from core.workflow.graph_engine.condition_handlers.condition_manager import ConditionManager
from core.workflow.graph_engine.entities.event import (
    BaseAgentEvent,
    BaseIterationEvent,
    BaseLoopEvent,
    GraphEngineEvent,
    GraphRunFailedEvent,
    GraphRunPartialSucceededEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeRunExceptionEvent,
    NodeRunFailedEvent,
    NodeRunRetrieverResourceEvent,
    NodeRunRetryEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
    ParallelBranchRunFailedEvent,
    ParallelBranchRunStartedEvent,
    ParallelBranchRunSucceededEvent,
)
from core.workflow.graph_engine.entities.graph import Graph, GraphEdge
from core.workflow.graph_engine.entities.graph_init_params import GraphInitParams
from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState
from core.workflow.graph_engine.entities.runtime_route_state import RouteNodeState
from core.workflow.nodes import NodeType
from core.workflow.nodes.agent.agent_node import AgentNode
from core.workflow.nodes.agent.entities import AgentNodeData
from core.workflow.nodes.answer.answer_stream_processor import AnswerStreamProcessor
from core.workflow.nodes.answer.base_stream_processor import StreamProcessor
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.base.entities import BaseNodeData
from core.workflow.nodes.end.end_stream_processor import EndStreamProcessor
from core.workflow.nodes.enums import ErrorStrategy, FailBranchSourceHandle
from core.workflow.nodes.event import RunCompletedEvent, RunRetrieverResourceEvent, RunStreamChunkEvent
from core.workflow.nodes.node_mapping import NODE_TYPE_CLASSES_MAPPING
from core.workflow.utils import variable_utils
from libs.flask_utils import preserve_flask_contexts
from models.enums import UserFrom
from models.workflow import WorkflowType

logger = logging.getLogger(__name__)


class GraphEngineThreadPool(ThreadPoolExecutor):
    def __init__(
        self,
        max_workers=None,
        thread_name_prefix="",
        initializer=None,
        initargs=(),
        max_submit_count=dify_config.MAX_SUBMIT_COUNT,
    ) -> None:
        super().__init__(max_workers, thread_name_prefix, initializer, initargs)
        self.max_submit_count = max_submit_count
        self.submit_count = 0

    def submit(self, fn, /, *args, **kwargs):
        self.submit_count += 1
        self.check_is_full()

        return super().submit(fn, *args, **kwargs)

    def task_done_callback(self, future):
        self.submit_count -= 1

    def check_is_full(self) -> None:
        if self.submit_count > self.max_submit_count:
            raise ValueError(f"Max submit count {self.max_submit_count} of workflow thread pool reached.")


class GraphEngine:
    workflow_thread_pool_mapping: dict[str, GraphEngineThreadPool] = {}

    def __init__(
        self,
        tenant_id: str,
        app_id: str,
        workflow_type: WorkflowType,
        workflow_id: str,
        user_id: str,
        user_from: UserFrom,
        invoke_from: InvokeFrom,
        call_depth: int,
        graph: Graph,
        graph_config: Mapping[str, Any],
        graph_runtime_state: GraphRuntimeState,
        max_execution_steps: int,
        max_execution_time: int,
        thread_pool_id: Optional[str] = None,
    ) -> None:
        thread_pool_max_submit_count = dify_config.MAX_SUBMIT_COUNT
        thread_pool_max_workers = 10

        # init thread pool
        if thread_pool_id:
            if thread_pool_id not in GraphEngine.workflow_thread_pool_mapping:
                raise ValueError(f"Max submit count {thread_pool_max_submit_count} of workflow thread pool reached.")

            self.thread_pool_id = thread_pool_id
            self.thread_pool = GraphEngine.workflow_thread_pool_mapping[thread_pool_id]
            self.is_main_thread_pool = False
        else:
            self.thread_pool = GraphEngineThreadPool(
                max_workers=thread_pool_max_workers, max_submit_count=thread_pool_max_submit_count
            )
            self.thread_pool_id = str(uuid.uuid4())
            self.is_main_thread_pool = True
            GraphEngine.workflow_thread_pool_mapping[self.thread_pool_id] = self.thread_pool

        self.graph = graph
        self.init_params = GraphInitParams(
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_type=workflow_type,
            workflow_id=workflow_id,
            graph_config=graph_config,
            user_id=user_id,
            user_from=user_from,
            invoke_from=invoke_from,
            call_depth=call_depth,
        )

        self.graph_runtime_state = graph_runtime_state

        self.max_execution_steps = max_execution_steps
        self.max_execution_time = max_execution_time

    def run(self) -> Generator[GraphEngineEvent, None, None]:
        # trigger graph run start event
        yield GraphRunStartedEvent()
        handle_exceptions: list[str] = []
        stream_processor: StreamProcessor

        try:
            if self.init_params.workflow_type == WorkflowType.CHAT:
                stream_processor = AnswerStreamProcessor(
                    graph=self.graph, variable_pool=self.graph_runtime_state.variable_pool
                )
            else:
                stream_processor = EndStreamProcessor(
                    graph=self.graph, variable_pool=self.graph_runtime_state.variable_pool
                )

            # run graph
            generator = stream_processor.process(
                self._run(start_node_id=self.graph.root_node_id, handle_exceptions=handle_exceptions)
            )
            for item in generator:
                try:
                    yield item
                    if isinstance(item, NodeRunFailedEvent):
                        yield GraphRunFailedEvent(
                            error=item.route_node_state.failed_reason or "Unknown error.",
                            exceptions_count=len(handle_exceptions),
                        )
                        return
                    elif isinstance(item, NodeRunSucceededEvent):
                        if item.node_type == NodeType.END:
                            self.graph_runtime_state.outputs = (
                                dict(item.route_node_state.node_run_result.outputs)
                                if item.route_node_state.node_run_result
                                and item.route_node_state.node_run_result.outputs
                                else {}
                            )
                        elif item.node_type == NodeType.ANSWER:
                            if "answer" not in self.graph_runtime_state.outputs:
                                self.graph_runtime_state.outputs["answer"] = ""

                            self.graph_runtime_state.outputs["answer"] += "\n" + (
                                item.route_node_state.node_run_result.outputs.get("answer", "")
                                if item.route_node_state.node_run_result
                                and item.route_node_state.node_run_result.outputs
                                else ""
                            )

                            self.graph_runtime_state.outputs["answer"] = self.graph_runtime_state.outputs[
                                "answer"
                            ].strip()
                except Exception as e:
                    logger.exception("Graph run failed")
                    yield GraphRunFailedEvent(error=str(e), exceptions_count=len(handle_exceptions))
                    return
            # count exceptions to determine partial success
            if len(handle_exceptions) > 0:
                yield GraphRunPartialSucceededEvent(
                    exceptions_count=len(handle_exceptions), outputs=self.graph_runtime_state.outputs
                )
            else:
                # trigger graph run success event
                yield GraphRunSucceededEvent(outputs=self.graph_runtime_state.outputs)
            self._release_thread()
        except GraphRunFailedError as e:
            yield GraphRunFailedEvent(error=e.error, exceptions_count=len(handle_exceptions))
            self._release_thread()
            return
        except Exception as e:
            logger.exception("Unknown Error when graph running")
            yield GraphRunFailedEvent(error=str(e), exceptions_count=len(handle_exceptions))
            self._release_thread()
            raise e

    def _release_thread(self):
        if self.is_main_thread_pool and self.thread_pool_id in GraphEngine.workflow_thread_pool_mapping:
            del GraphEngine.workflow_thread_pool_mapping[self.thread_pool_id]

    def _run(
        self,
        start_node_id: str,
        in_parallel_id: Optional[str] = None,
        parent_parallel_id: Optional[str] = None,
        parent_parallel_start_node_id: Optional[str] = None,
        handle_exceptions: list[str] = [],
    ) -> Generator[GraphEngineEvent, None, None]:
        parallel_start_node_id = None
        if in_parallel_id:
            parallel_start_node_id = start_node_id

        next_node_id = start_node_id
        previous_route_node_state: Optional[RouteNodeState] = None
        while True:
            # max steps reached
            if self.graph_runtime_state.node_run_steps > self.max_execution_steps:
                raise GraphRunFailedError("Max steps {} reached.".format(self.max_execution_steps))

            # or max execution time reached
            if self._is_timed_out(
                start_at=self.graph_runtime_state.start_at, max_execution_time=self.max_execution_time
            ):
                raise GraphRunFailedError("Max execution time {}s reached.".format(self.max_execution_time))

            # init route node state
            route_node_state = self.graph_runtime_state.node_run_state.create_node_state(node_id=next_node_id)

            # get node config
            node_id = route_node_state.node_id
            node_config = self.graph.node_id_config_mapping.get(node_id)
            if not node_config:
                raise GraphRunFailedError(f"Node {node_id} config not found.")

            # convert to specific node
            node_type = NodeType(node_config.get("data", {}).get("type"))
            node_version = node_config.get("data", {}).get("version", "1")
            node_cls = NODE_TYPE_CLASSES_MAPPING[node_type][node_version]

            previous_node_id = previous_route_node_state.node_id if previous_route_node_state else None

            # init workflow run state
            node_instance = node_cls(  # type: ignore
                id=route_node_state.id,
                config=node_config,
                graph_init_params=self.init_params,
                graph=self.graph,
                graph_runtime_state=self.graph_runtime_state,
                previous_node_id=previous_node_id,
                thread_pool_id=self.thread_pool_id,
            )
            node_instance = cast(BaseNode[BaseNodeData], node_instance)
            try:
                # run node
                generator = self._run_node(
                    node_instance=node_instance,
                    route_node_state=route_node_state,
                    parallel_id=in_parallel_id,
                    parallel_start_node_id=parallel_start_node_id,
                    parent_parallel_id=parent_parallel_id,
                    parent_parallel_start_node_id=parent_parallel_start_node_id,
                    handle_exceptions=handle_exceptions,
                )

                for item in generator:
                    if isinstance(item, NodeRunStartedEvent):
                        self.graph_runtime_state.node_run_steps += 1
                        item.route_node_state.index = self.graph_runtime_state.node_run_steps

                    yield item

                self.graph_runtime_state.node_run_state.node_state_mapping[route_node_state.id] = route_node_state

                # append route
                if previous_route_node_state:
                    self.graph_runtime_state.node_run_state.add_route(
                        source_node_state_id=previous_route_node_state.id, target_node_state_id=route_node_state.id
                    )
            except Exception as e:
                route_node_state.status = RouteNodeState.Status.FAILED
                route_node_state.failed_reason = str(e)
                yield NodeRunFailedEvent(
                    error=str(e),
                    id=node_instance.id,
                    node_id=next_node_id,
                    node_type=node_type,
                    node_data=node_instance.node_data,
                    route_node_state=route_node_state,
                    parallel_id=in_parallel_id,
                    parallel_start_node_id=parallel_start_node_id,
                    parent_parallel_id=parent_parallel_id,
                    parent_parallel_start_node_id=parent_parallel_start_node_id,
                    node_version=node_instance.version(),
                )
                raise e

            # It may not be necessary, but it is necessary. :)
            if (
                self.graph.node_id_config_mapping[next_node_id].get("data", {}).get("type", "").lower()
                == NodeType.END.value
            ):
                break

            previous_route_node_state = route_node_state

            # get next node ids
            edge_mappings = self.graph.edge_mapping.get(next_node_id)
            if not edge_mappings:
                break

            if len(edge_mappings) == 1:
                edge = edge_mappings[0]
                if (
                    previous_route_node_state.status == RouteNodeState.Status.EXCEPTION
                    and node_instance.node_data.error_strategy == ErrorStrategy.FAIL_BRANCH
                    and edge.run_condition is None
                ):
                    break
                if edge.run_condition:
                    result = ConditionManager.get_condition_handler(
                        init_params=self.init_params,
                        graph=self.graph,
                        run_condition=edge.run_condition,
                    ).check(
                        graph_runtime_state=self.graph_runtime_state,
                        previous_route_node_state=previous_route_node_state,
                    )

                    if not result:
                        break

                next_node_id = edge.target_node_id
            else:
                final_node_id = None

                if any(edge.run_condition for edge in edge_mappings):
                    # if nodes has run conditions, get node id which branch to take based on the run condition results
                    condition_edge_mappings: dict[str, list[GraphEdge]] = {}
                    for edge in edge_mappings:
                        if edge.run_condition:
                            run_condition_hash = edge.run_condition.hash
                            if run_condition_hash not in condition_edge_mappings:
                                condition_edge_mappings[run_condition_hash] = []

                            condition_edge_mappings[run_condition_hash].append(edge)

                    for _, sub_edge_mappings in condition_edge_mappings.items():
                        if len(sub_edge_mappings) == 0:
                            continue

                        edge = cast(GraphEdge, sub_edge_mappings[0])
                        if edge.run_condition is None:
                            logger.warning(f"Edge {edge.target_node_id} run condition is None")
                            continue

                        result = ConditionManager.get_condition_handler(
                            init_params=self.init_params,
                            graph=self.graph,
                            run_condition=edge.run_condition,
                        ).check(
                            graph_runtime_state=self.graph_runtime_state,
                            previous_route_node_state=previous_route_node_state,
                        )

                        if not result:
                            continue

                        if len(sub_edge_mappings) == 1:
                            final_node_id = edge.target_node_id
                        else:
                            parallel_generator = self._run_parallel_branches(
                                edge_mappings=sub_edge_mappings,
                                in_parallel_id=in_parallel_id,
                                parallel_start_node_id=parallel_start_node_id,
                                handle_exceptions=handle_exceptions,
                            )

                            for parallel_result in parallel_generator:
                                if isinstance(parallel_result, str):
                                    final_node_id = parallel_result
                                else:
                                    yield parallel_result

                        break

                    if not final_node_id:
                        break

                    next_node_id = final_node_id
                elif (
                    node_instance.node_data.error_strategy == ErrorStrategy.FAIL_BRANCH
                    and node_instance.should_continue_on_error
                    and previous_route_node_state.status == RouteNodeState.Status.EXCEPTION
                ):
                    break
                else:
                    parallel_generator = self._run_parallel_branches(
                        edge_mappings=edge_mappings,
                        in_parallel_id=in_parallel_id,
                        parallel_start_node_id=parallel_start_node_id,
                        handle_exceptions=handle_exceptions,
                    )

                    for generated_item in parallel_generator:
                        if isinstance(generated_item, str):
                            final_node_id = generated_item
                        else:
                            yield generated_item

                    if not final_node_id:
                        break

                    next_node_id = final_node_id

            if in_parallel_id and self.graph.node_parallel_mapping.get(next_node_id, "") != in_parallel_id:
                break

    def _run_parallel_branches(
        self,
        edge_mappings: list[GraphEdge],
        in_parallel_id: Optional[str] = None,
        parallel_start_node_id: Optional[str] = None,
        handle_exceptions: list[str] = [],
    ) -> Generator[GraphEngineEvent | str, None, None]:
        # if nodes has no run conditions, parallel run all nodes
        parallel_id = self.graph.node_parallel_mapping.get(edge_mappings[0].target_node_id)
        if not parallel_id:
            node_id = edge_mappings[0].target_node_id
            node_config = self.graph.node_id_config_mapping.get(node_id)
            if not node_config:
                raise GraphRunFailedError(
                    f"Node {node_id} related parallel not found or incorrectly connected to multiple parallel branches."
                )

            node_title = node_config.get("data", {}).get("title")
            raise GraphRunFailedError(
                f"Node {node_title} related parallel not found or incorrectly connected to multiple parallel branches."
            )

        parallel = self.graph.parallel_mapping.get(parallel_id)
        if not parallel:
            raise GraphRunFailedError(f"Parallel {parallel_id} not found.")

        # run parallel nodes, run in new thread and use queue to get results
        q: queue.Queue = queue.Queue()

        # Create a list to store the threads
        futures = []

        # new thread
        for edge in edge_mappings:
            if (
                edge.target_node_id not in self.graph.node_parallel_mapping
                or self.graph.node_parallel_mapping.get(edge.target_node_id, "") != parallel_id
            ):
                continue

            future = self.thread_pool.submit(
                self._run_parallel_node,
                **{
                    "flask_app": current_app._get_current_object(),  # type: ignore[attr-defined]
                    "q": q,
                    "context": contextvars.copy_context(),
                    "parallel_id": parallel_id,
                    "parallel_start_node_id": edge.target_node_id,
                    "parent_parallel_id": in_parallel_id,
                    "parent_parallel_start_node_id": parallel_start_node_id,
                    "handle_exceptions": handle_exceptions,
                },
            )

            future.add_done_callback(self.thread_pool.task_done_callback)

            futures.append(future)

        succeeded_count = 0
        while True:
            try:
                event = q.get(timeout=1)
                if event is None:
                    break

                yield event
                if not isinstance(event, BaseAgentEvent) and event.parallel_id == parallel_id:
                    if isinstance(event, ParallelBranchRunSucceededEvent):
                        succeeded_count += 1
                        if succeeded_count == len(futures):
                            q.put(None)

                        continue
                    elif isinstance(event, ParallelBranchRunFailedEvent):
                        raise GraphRunFailedError(event.error)
            except queue.Empty:
                continue

        # wait all threads
        wait(futures)

        # get final node id
        final_node_id = parallel.end_to_node_id
        if final_node_id:
            yield final_node_id

    def _run_parallel_node(
        self,
        flask_app: Flask,
        context: contextvars.Context,
        q: queue.Queue,
        parallel_id: str,
        parallel_start_node_id: str,
        parent_parallel_id: Optional[str] = None,
        parent_parallel_start_node_id: Optional[str] = None,
        handle_exceptions: list[str] = [],
    ) -> None:
        """
        Run parallel nodes
        """

        with preserve_flask_contexts(flask_app, context_vars=context):
            try:
                q.put(
                    ParallelBranchRunStartedEvent(
                        parallel_id=parallel_id,
                        parallel_start_node_id=parallel_start_node_id,
                        parent_parallel_id=parent_parallel_id,
                        parent_parallel_start_node_id=parent_parallel_start_node_id,
                    )
                )

                # run node
                generator = self._run(
                    start_node_id=parallel_start_node_id,
                    in_parallel_id=parallel_id,
                    parent_parallel_id=parent_parallel_id,
                    parent_parallel_start_node_id=parent_parallel_start_node_id,
                    handle_exceptions=handle_exceptions,
                )

                for item in generator:
                    q.put(item)

                # trigger graph run success event
                q.put(
                    ParallelBranchRunSucceededEvent(
                        parallel_id=parallel_id,
                        parallel_start_node_id=parallel_start_node_id,
                        parent_parallel_id=parent_parallel_id,
                        parent_parallel_start_node_id=parent_parallel_start_node_id,
                    )
                )
            except GraphRunFailedError as e:
                q.put(
                    ParallelBranchRunFailedEvent(
                        parallel_id=parallel_id,
                        parallel_start_node_id=parallel_start_node_id,
                        parent_parallel_id=parent_parallel_id,
                        parent_parallel_start_node_id=parent_parallel_start_node_id,
                        error=e.error,
                    )
                )
            except Exception as e:
                logger.exception("Unknown Error when generating in parallel")
                q.put(
                    ParallelBranchRunFailedEvent(
                        parallel_id=parallel_id,
                        parallel_start_node_id=parallel_start_node_id,
                        parent_parallel_id=parent_parallel_id,
                        parent_parallel_start_node_id=parent_parallel_start_node_id,
                        error=str(e),
                    )
                )

    def _run_node(
        self,
        node_instance: BaseNode[BaseNodeData],
        route_node_state: RouteNodeState,
        parallel_id: Optional[str] = None,
        parallel_start_node_id: Optional[str] = None,
        parent_parallel_id: Optional[str] = None,
        parent_parallel_start_node_id: Optional[str] = None,
        handle_exceptions: list[str] = [],
    ) -> Generator[GraphEngineEvent, None, None]:
        """
        Run node
        """
        # trigger node run start event
        agent_strategy = (
            AgentNodeStrategyInit(
                name=cast(AgentNodeData, node_instance.node_data).agent_strategy_name,
                icon=cast(AgentNode, node_instance).agent_strategy_icon,
            )
            if node_instance.node_type == NodeType.AGENT
            else None
        )
        yield NodeRunStartedEvent(
            id=node_instance.id,
            node_id=node_instance.node_id,
            node_type=node_instance.node_type,
            node_data=node_instance.node_data,
            route_node_state=route_node_state,
            predecessor_node_id=node_instance.previous_node_id,
            parallel_id=parallel_id,
            parallel_start_node_id=parallel_start_node_id,
            parent_parallel_id=parent_parallel_id,
            parent_parallel_start_node_id=parent_parallel_start_node_id,
            agent_strategy=agent_strategy,
            node_version=node_instance.version(),
        )

        max_retries = node_instance.node_data.retry_config.max_retries
        retry_interval = node_instance.node_data.retry_config.retry_interval_seconds
        retries = 0
        should_continue_retry = True
        while should_continue_retry and retries <= max_retries:
            try:
                # run node
                retry_start_at = datetime.now(UTC).replace(tzinfo=None)
                # yield control to other threads
                time.sleep(0.001)
                event_stream = node_instance.run()
                for event in event_stream:
                    if isinstance(event, GraphEngineEvent):
                        # add parallel info to iteration event
                        if isinstance(event, BaseIterationEvent | BaseLoopEvent):
                            event.parallel_id = parallel_id
                            event.parallel_start_node_id = parallel_start_node_id
                            event.parent_parallel_id = parent_parallel_id
                            event.parent_parallel_start_node_id = parent_parallel_start_node_id
                        yield event
                    else:
                        if isinstance(event, RunCompletedEvent):
                            run_result = event.run_result
                            if run_result.status == WorkflowNodeExecutionStatus.FAILED:
                                if (
                                    retries == max_retries
                                    and node_instance.node_type == NodeType.HTTP_REQUEST
                                    and run_result.outputs
                                    and not node_instance.should_continue_on_error
                                ):
                                    run_result.status = WorkflowNodeExecutionStatus.SUCCEEDED
                                if node_instance.should_retry and retries < max_retries:
                                    retries += 1
                                    route_node_state.node_run_result = run_result
                                    yield NodeRunRetryEvent(
                                        id=str(uuid.uuid4()),
                                        node_id=node_instance.node_id,
                                        node_type=node_instance.node_type,
                                        node_data=node_instance.node_data,
                                        route_node_state=route_node_state,
                                        predecessor_node_id=node_instance.previous_node_id,
                                        parallel_id=parallel_id,
                                        parallel_start_node_id=parallel_start_node_id,
                                        parent_parallel_id=parent_parallel_id,
                                        parent_parallel_start_node_id=parent_parallel_start_node_id,
                                        error=run_result.error or "Unknown error",
                                        retry_index=retries,
                                        start_at=retry_start_at,
                                        node_version=node_instance.version(),
                                    )
                                    time.sleep(retry_interval)
                                    break
                            route_node_state.set_finished(run_result=run_result)

                            if run_result.status == WorkflowNodeExecutionStatus.FAILED:
                                if node_instance.should_continue_on_error:
                                    # if run failed, handle error
                                    run_result = self._handle_continue_on_error(
                                        node_instance,
                                        event.run_result,
                                        self.graph_runtime_state.variable_pool,
                                        handle_exceptions=handle_exceptions,
                                    )
                                    route_node_state.node_run_result = run_result
                                    route_node_state.status = RouteNodeState.Status.EXCEPTION
                                    if run_result.outputs:
                                        for variable_key, variable_value in run_result.outputs.items():
                                            # append variables to variable pool recursively
                                            self._append_variables_recursively(
                                                node_id=node_instance.node_id,
                                                variable_key_list=[variable_key],
                                                variable_value=variable_value,
                                            )
                                    yield NodeRunExceptionEvent(
                                        error=run_result.error or "System Error",
                                        id=node_instance.id,
                                        node_id=node_instance.node_id,
                                        node_type=node_instance.node_type,
                                        node_data=node_instance.node_data,
                                        route_node_state=route_node_state,
                                        parallel_id=parallel_id,
                                        parallel_start_node_id=parallel_start_node_id,
                                        parent_parallel_id=parent_parallel_id,
                                        parent_parallel_start_node_id=parent_parallel_start_node_id,
                                        node_version=node_instance.version(),
                                    )
                                    should_continue_retry = False
                                else:
                                    yield NodeRunFailedEvent(
                                        error=route_node_state.failed_reason or "Unknown error.",
                                        id=node_instance.id,
                                        node_id=node_instance.node_id,
                                        node_type=node_instance.node_type,
                                        node_data=node_instance.node_data,
                                        route_node_state=route_node_state,
                                        parallel_id=parallel_id,
                                        parallel_start_node_id=parallel_start_node_id,
                                        parent_parallel_id=parent_parallel_id,
                                        parent_parallel_start_node_id=parent_parallel_start_node_id,
                                        node_version=node_instance.version(),
                                    )
                                should_continue_retry = False
                            elif run_result.status == WorkflowNodeExecutionStatus.SUCCEEDED:
                                if (
                                    node_instance.should_continue_on_error
                                    and self.graph.edge_mapping.get(node_instance.node_id)
                                    and node_instance.node_data.error_strategy is ErrorStrategy.FAIL_BRANCH
                                ):
                                    run_result.edge_source_handle = FailBranchSourceHandle.SUCCESS
                                if run_result.metadata and run_result.metadata.get(
                                    WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS
                                ):
                                    # plus state total_tokens
                                    self.graph_runtime_state.total_tokens += int(
                                        run_result.metadata.get(WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS)  # type: ignore[arg-type]
                                    )

                                if run_result.llm_usage:
                                    # use the latest usage
                                    self.graph_runtime_state.llm_usage += run_result.llm_usage

                                # append node output variables to variable pool
                                if run_result.outputs:
                                    for variable_key, variable_value in run_result.outputs.items():
                                        # append variables to variable pool recursively
                                        self._append_variables_recursively(
                                            node_id=node_instance.node_id,
                                            variable_key_list=[variable_key],
                                            variable_value=variable_value,
                                        )

                                # When setting metadata, convert to dict first
                                if not run_result.metadata:
                                    run_result.metadata = {}

                                if parallel_id and parallel_start_node_id:
                                    metadata_dict = dict(run_result.metadata)
                                    metadata_dict[WorkflowNodeExecutionMetadataKey.PARALLEL_ID] = parallel_id
                                    metadata_dict[WorkflowNodeExecutionMetadataKey.PARALLEL_START_NODE_ID] = (
                                        parallel_start_node_id
                                    )
                                    if parent_parallel_id and parent_parallel_start_node_id:
                                        metadata_dict[WorkflowNodeExecutionMetadataKey.PARENT_PARALLEL_ID] = (
                                            parent_parallel_id
                                        )
                                        metadata_dict[
                                            WorkflowNodeExecutionMetadataKey.PARENT_PARALLEL_START_NODE_ID
                                        ] = parent_parallel_start_node_id
                                    run_result.metadata = metadata_dict

                                yield NodeRunSucceededEvent(
                                    id=node_instance.id,
                                    node_id=node_instance.node_id,
                                    node_type=node_instance.node_type,
                                    node_data=node_instance.node_data,
                                    route_node_state=route_node_state,
                                    parallel_id=parallel_id,
                                    parallel_start_node_id=parallel_start_node_id,
                                    parent_parallel_id=parent_parallel_id,
                                    parent_parallel_start_node_id=parent_parallel_start_node_id,
                                    node_version=node_instance.version(),
                                )
                                should_continue_retry = False

                            break
                        elif isinstance(event, RunStreamChunkEvent):
                            yield NodeRunStreamChunkEvent(
                                id=node_instance.id,
                                node_id=node_instance.node_id,
                                node_type=node_instance.node_type,
                                node_data=node_instance.node_data,
                                chunk_content=event.chunk_content,
                                from_variable_selector=event.from_variable_selector,
                                route_node_state=route_node_state,
                                parallel_id=parallel_id,
                                parallel_start_node_id=parallel_start_node_id,
                                parent_parallel_id=parent_parallel_id,
                                parent_parallel_start_node_id=parent_parallel_start_node_id,
                                node_version=node_instance.version(),
                            )
                        elif isinstance(event, RunRetrieverResourceEvent):
                            yield NodeRunRetrieverResourceEvent(
                                id=node_instance.id,
                                node_id=node_instance.node_id,
                                node_type=node_instance.node_type,
                                node_data=node_instance.node_data,
                                retriever_resources=event.retriever_resources,
                                context=event.context,
                                route_node_state=route_node_state,
                                parallel_id=parallel_id,
                                parallel_start_node_id=parallel_start_node_id,
                                parent_parallel_id=parent_parallel_id,
                                parent_parallel_start_node_id=parent_parallel_start_node_id,
                                node_version=node_instance.version(),
                            )
            except GenerateTaskStoppedError:
                # trigger node run failed event
                route_node_state.status = RouteNodeState.Status.FAILED
                route_node_state.failed_reason = "Workflow stopped."
                yield NodeRunFailedEvent(
                    error="Workflow stopped.",
                    id=node_instance.id,
                    node_id=node_instance.node_id,
                    node_type=node_instance.node_type,
                    node_data=node_instance.node_data,
                    route_node_state=route_node_state,
                    parallel_id=parallel_id,
                    parallel_start_node_id=parallel_start_node_id,
                    parent_parallel_id=parent_parallel_id,
                    parent_parallel_start_node_id=parent_parallel_start_node_id,
                    node_version=node_instance.version(),
                )
                return
            except Exception as e:
                logger.exception(f"Node {node_instance.node_data.title} run failed")
                raise e

    def _append_variables_recursively(self, node_id: str, variable_key_list: list[str], variable_value: VariableValue):
        """
        Append variables recursively
        :param node_id: node id
        :param variable_key_list: variable key list
        :param variable_value: variable value
        :return:
        """
        variable_utils.append_variables_recursively(
            self.graph_runtime_state.variable_pool,
            node_id,
            variable_key_list,
            variable_value,
        )

    def _is_timed_out(self, start_at: float, max_execution_time: int) -> bool:
        """
        Check timeout
        :param start_at: start time
        :param max_execution_time: max execution time
        :return:
        """
        return time.perf_counter() - start_at > max_execution_time

    def create_copy(self):
        """
        create a graph engine copy
        :return: graph engine with a new variable pool and initialized total tokens
        """
        new_instance = copy(self)
        new_instance.graph_runtime_state = copy(self.graph_runtime_state)
        new_instance.graph_runtime_state.variable_pool = deepcopy(self.graph_runtime_state.variable_pool)
        new_instance.graph_runtime_state.total_tokens = 0
        return new_instance

    def _handle_continue_on_error(
        self,
        node_instance: BaseNode[BaseNodeData],
        error_result: NodeRunResult,
        variable_pool: VariablePool,
        handle_exceptions: list[str] = [],
    ) -> NodeRunResult:
        """
        handle continue on error when self._should_continue_on_error is True


        :param    error_result (NodeRunResult): error run result
        :param    variable_pool (VariablePool): variable pool
        :return:  excption run result
        """
        # add error message and error type to variable pool
        variable_pool.add([node_instance.node_id, "error_message"], error_result.error)
        variable_pool.add([node_instance.node_id, "error_type"], error_result.error_type)
        # add error message to handle_exceptions
        handle_exceptions.append(error_result.error or "")
        node_error_args: dict[str, Any] = {
            "status": WorkflowNodeExecutionStatus.EXCEPTION,
            "error": error_result.error,
            "inputs": error_result.inputs,
            "metadata": {
                WorkflowNodeExecutionMetadataKey.ERROR_STRATEGY: node_instance.node_data.error_strategy,
            },
        }

        if node_instance.node_data.error_strategy is ErrorStrategy.DEFAULT_VALUE:
            return NodeRunResult(
                **node_error_args,
                outputs={
                    **node_instance.node_data.default_value_dict,
                    "error_message": error_result.error,
                    "error_type": error_result.error_type,
                },
            )
        elif node_instance.node_data.error_strategy is ErrorStrategy.FAIL_BRANCH:
            if self.graph.edge_mapping.get(node_instance.node_id):
                node_error_args["edge_source_handle"] = FailBranchSourceHandle.FAILED
            return NodeRunResult(
                **node_error_args,
                outputs={
                    "error_message": error_result.error,
                    "error_type": error_result.error_type,
                },
            )
        return error_result


class GraphRunFailedError(Exception):
    def __init__(self, error: str):
        self.error = error
