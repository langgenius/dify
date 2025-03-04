import logging
from collections.abc import Generator, Mapping, Sequence
from datetime import datetime, timezone
from typing import Any, cast

from configs import dify_config
from core.variables import IntegerSegment
from core.workflow.entities.node_entities import NodeRunMetadataKey, NodeRunResult
from core.workflow.graph_engine.entities.event import (
    BaseGraphEvent,
    BaseNodeEvent,
    BaseParallelBranchEvent,
    GraphRunFailedEvent,
    InNodeEvent,
    LoopRunFailedEvent,
    LoopRunNextEvent,
    LoopRunStartedEvent,
    LoopRunSucceededEvent,
    NodeRunFailedEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.enums import NodeType
from core.workflow.nodes.event import NodeEvent, RunCompletedEvent
from core.workflow.nodes.loop.entities import LoopNodeData
from core.workflow.utils.condition.processor import ConditionProcessor
from models.workflow import WorkflowNodeExecutionStatus

logger = logging.getLogger(__name__)


class LoopNode(BaseNode[LoopNodeData]):
    """
    Loop Node.
    """

    _node_data_cls = LoopNodeData
    _node_type = NodeType.LOOP

    def _run(self) -> Generator[NodeEvent | InNodeEvent, None, None]:
        """Run the node."""
        # Get inputs
        loop_count = self.node_data.loop_count
        break_conditions = self.node_data.break_conditions
        logical_operator = self.node_data.logical_operator

        inputs = {"loop_count": loop_count}

        if not self.node_data.start_node_id:
            raise ValueError(f"field start_node_id in loop {self.node_id} not found")

        # Initialize graph
        loop_graph = Graph.init(graph_config=self.graph_config, root_node_id=self.node_data.start_node_id)
        if not loop_graph:
            raise ValueError("loop graph not found")

        # Initialize variable pool
        variable_pool = self.graph_runtime_state.variable_pool
        variable_pool.add([self.node_id, "index"], 0)

        from core.workflow.graph_engine.graph_engine import GraphEngine

        graph_engine = GraphEngine(
            tenant_id=self.tenant_id,
            app_id=self.app_id,
            workflow_type=self.workflow_type,
            workflow_id=self.workflow_id,
            user_id=self.user_id,
            user_from=self.user_from,
            invoke_from=self.invoke_from,
            call_depth=self.workflow_call_depth,
            graph=loop_graph,
            graph_config=self.graph_config,
            variable_pool=variable_pool,
            max_execution_steps=dify_config.WORKFLOW_MAX_EXECUTION_STEPS,
            max_execution_time=dify_config.WORKFLOW_MAX_EXECUTION_TIME,
            thread_pool_id=self.thread_pool_id,
        )

        start_at = datetime.now(timezone.utc).replace(tzinfo=None)
        condition_processor = ConditionProcessor()

        # Start Loop event
        yield LoopRunStartedEvent(
            loop_id=self.id,
            loop_node_id=self.node_id,
            loop_node_type=self.node_type,
            loop_node_data=self.node_data,
            start_at=start_at,
            inputs=inputs,
            metadata={"loop_length": loop_count},
            predecessor_node_id=self.previous_node_id,
        )

        yield LoopRunNextEvent(
            loop_id=self.id,
            loop_node_id=self.node_id,
            loop_node_type=self.node_type,
            loop_node_data=self.node_data,
            index=0,
            pre_loop_output=None,
        )

        try:
            check_break_result = False
            for i in range(loop_count):
                # Run workflow
                rst = graph_engine.run()
                current_index_variable = variable_pool.get([self.node_id, "index"])
                if not isinstance(current_index_variable, IntegerSegment):
                    raise ValueError(f"loop {self.node_id} current index not found")
                current_index = current_index_variable.value

                check_break_result = False

                for event in rst:
                    if isinstance(event, (BaseNodeEvent | BaseParallelBranchEvent)) and not event.in_loop_id:
                        event.in_loop_id = self.node_id

                    if (
                        isinstance(event, BaseNodeEvent)
                        and event.node_type == NodeType.LOOP_START
                        and not isinstance(event, NodeRunStreamChunkEvent)
                    ):
                        continue

                    if isinstance(event, NodeRunSucceededEvent):
                        yield self._handle_event_metadata(event=event, iter_run_index=current_index)

                        # Check if all variables in break conditions exist
                        exists_variable = False
                        for condition in break_conditions:
                            if not self.graph_runtime_state.variable_pool.get(condition.variable_selector):
                                exists_variable = False
                                break
                            else:
                                exists_variable = True
                        if exists_variable:
                            input_conditions, group_result, check_break_result = condition_processor.process_conditions(
                                variable_pool=self.graph_runtime_state.variable_pool,
                                conditions=break_conditions,
                                operator=logical_operator,
                            )
                            if check_break_result:
                                break

                    elif isinstance(event, BaseGraphEvent):
                        if isinstance(event, GraphRunFailedEvent):
                            # Loop run failed
                            yield LoopRunFailedEvent(
                                loop_id=self.id,
                                loop_node_id=self.node_id,
                                loop_node_type=self.node_type,
                                loop_node_data=self.node_data,
                                start_at=start_at,
                                inputs=inputs,
                                steps=i,
                                metadata={
                                    NodeRunMetadataKey.TOTAL_TOKENS: graph_engine.graph_runtime_state.total_tokens,
                                    "completed_reason": "error",
                                },
                                error=event.error,
                            )
                            yield RunCompletedEvent(
                                run_result=NodeRunResult(
                                    status=WorkflowNodeExecutionStatus.FAILED,
                                    error=event.error,
                                    metadata={
                                        NodeRunMetadataKey.TOTAL_TOKENS: graph_engine.graph_runtime_state.total_tokens
                                    },
                                )
                            )
                            return
                    elif isinstance(event, NodeRunFailedEvent):
                        # Loop run failed
                        yield event
                        yield LoopRunFailedEvent(
                            loop_id=self.id,
                            loop_node_id=self.node_id,
                            loop_node_type=self.node_type,
                            loop_node_data=self.node_data,
                            start_at=start_at,
                            inputs=inputs,
                            steps=i,
                            metadata={
                                NodeRunMetadataKey.TOTAL_TOKENS: graph_engine.graph_runtime_state.total_tokens,
                                "completed_reason": "error",
                            },
                            error=event.error,
                        )
                        yield RunCompletedEvent(
                            run_result=NodeRunResult(
                                status=WorkflowNodeExecutionStatus.FAILED,
                                error=event.error,
                                metadata={
                                    NodeRunMetadataKey.TOTAL_TOKENS: graph_engine.graph_runtime_state.total_tokens
                                },
                            )
                        )
                        return
                    else:
                        yield self._handle_event_metadata(event=cast(InNodeEvent, event), iter_run_index=current_index)

                # Remove all nodes outputs from variable pool
                for node_id in loop_graph.node_ids:
                    variable_pool.remove([node_id])

                if check_break_result:
                    break

                # Move to next loop
                next_index = current_index + 1
                variable_pool.add([self.node_id, "index"], next_index)

                yield LoopRunNextEvent(
                    loop_id=self.id,
                    loop_node_id=self.node_id,
                    loop_node_type=self.node_type,
                    loop_node_data=self.node_data,
                    index=next_index,
                    pre_loop_output=None,
                )

            # Loop completed successfully
            yield LoopRunSucceededEvent(
                loop_id=self.id,
                loop_node_id=self.node_id,
                loop_node_type=self.node_type,
                loop_node_data=self.node_data,
                start_at=start_at,
                inputs=inputs,
                steps=loop_count,
                metadata={
                    NodeRunMetadataKey.TOTAL_TOKENS: graph_engine.graph_runtime_state.total_tokens,
                    "completed_reason": "loop_break" if check_break_result else "loop_completed",
                },
            )

            yield RunCompletedEvent(
                run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.SUCCEEDED,
                    metadata={NodeRunMetadataKey.TOTAL_TOKENS: graph_engine.graph_runtime_state.total_tokens},
                )
            )

        except Exception as e:
            # Loop failed
            logger.exception("Loop run failed")
            yield LoopRunFailedEvent(
                loop_id=self.id,
                loop_node_id=self.node_id,
                loop_node_type=self.node_type,
                loop_node_data=self.node_data,
                start_at=start_at,
                inputs=inputs,
                steps=loop_count,
                metadata={
                    "total_tokens": graph_engine.graph_runtime_state.total_tokens,
                    "completed_reason": "error",
                },
                error=str(e),
            )

            yield RunCompletedEvent(
                run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    error=str(e),
                    metadata={NodeRunMetadataKey.TOTAL_TOKENS: graph_engine.graph_runtime_state.total_tokens},
                )
            )

        finally:
            # Clean up
            variable_pool.remove([self.node_id, "index"])

    def _handle_event_metadata(
        self,
        *,
        event: BaseNodeEvent | InNodeEvent,
        iter_run_index: int,
    ) -> NodeRunStartedEvent | BaseNodeEvent | InNodeEvent:
        """
        add iteration metadata to event.
        """
        if not isinstance(event, BaseNodeEvent):
            return event
        if event.route_node_state.node_run_result:
            metadata = event.route_node_state.node_run_result.metadata
            if not metadata:
                metadata = {}
            if NodeRunMetadataKey.LOOP_ID not in metadata:
                metadata = {
                    **metadata,
                    NodeRunMetadataKey.LOOP_ID: self.node_id,
                    NodeRunMetadataKey.LOOP_INDEX: iter_run_index,
                }
                event.route_node_state.node_run_result.metadata = metadata
        return event

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: LoopNodeData,
    ) -> Mapping[str, Sequence[str]]:
        """
        Extract variable selector to variable mapping
        :param graph_config: graph config
        :param node_id: node id
        :param node_data: node data
        :return:
        """
        variable_mapping = {}

        # init graph
        loop_graph = Graph.init(graph_config=graph_config, root_node_id=node_data.start_node_id)

        if not loop_graph:
            raise ValueError("loop graph not found")

        for sub_node_id, sub_node_config in loop_graph.node_id_config_mapping.items():
            if sub_node_config.get("data", {}).get("loop_id") != node_id:
                continue

            # variable selector to variable mapping
            try:
                # Get node class
                from core.workflow.nodes.node_mapping import NODE_TYPE_CLASSES_MAPPING

                node_type = NodeType(sub_node_config.get("data", {}).get("type"))
                if node_type not in NODE_TYPE_CLASSES_MAPPING:
                    continue
                node_version = sub_node_config.get("data", {}).get("version", "1")
                node_cls = NODE_TYPE_CLASSES_MAPPING[node_type][node_version]

                sub_node_variable_mapping = node_cls.extract_variable_selector_to_variable_mapping(
                    graph_config=graph_config, config=sub_node_config
                )
                sub_node_variable_mapping = cast(dict[str, Sequence[str]], sub_node_variable_mapping)
            except NotImplementedError:
                sub_node_variable_mapping = {}

            # remove loop variables
            sub_node_variable_mapping = {
                sub_node_id + "." + key: value
                for key, value in sub_node_variable_mapping.items()
                if value[0] != node_id
            }

            variable_mapping.update(sub_node_variable_mapping)

        # remove variable out from loop
        variable_mapping = {
            key: value for key, value in variable_mapping.items() if value[0] not in loop_graph.node_ids
        }

        return variable_mapping
