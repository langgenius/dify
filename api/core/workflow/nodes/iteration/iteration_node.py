import logging
from collections.abc import Generator, Mapping, Sequence
from datetime import datetime, timezone
from typing import Any, cast

from configs import dify_config
from core.model_runtime.utils.encoders import jsonable_encoder
from core.workflow.entities.node_entities import NodeRunMetadataKey, NodeRunResult, NodeType
from core.workflow.graph_engine.entities.event import (
    BaseGraphEvent,
    BaseNodeEvent,
    BaseParallelBranchEvent,
    GraphRunFailedEvent,
    InNodeEvent,
    IterationRunFailedEvent,
    IterationRunNextEvent,
    IterationRunStartedEvent,
    IterationRunSucceededEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.nodes.base_node import BaseNode
from core.workflow.nodes.event import RunCompletedEvent, RunEvent
from core.workflow.nodes.iteration.entities import IterationNodeData
from models.workflow import WorkflowNodeExecutionStatus

logger = logging.getLogger(__name__)


class IterationNode(BaseNode):
    """
    Iteration Node.
    """

    _node_data_cls = IterationNodeData
    _node_type = NodeType.ITERATION

    def _run(self) -> Generator[RunEvent | InNodeEvent, None, None]:
        """
        Run the node.
        """
        self.node_data = cast(IterationNodeData, self.node_data)
        iterator_list_segment = self.graph_runtime_state.variable_pool.get(self.node_data.iterator_selector)

        if not iterator_list_segment:
            raise ValueError(f"Iterator variable {self.node_data.iterator_selector} not found")

        iterator_list_value = iterator_list_segment.to_object()

        if not isinstance(iterator_list_value, list):
            raise ValueError(f"Invalid iterator value: {iterator_list_value}, please provide a list.")

        inputs = {"iterator_selector": iterator_list_value}

        graph_config = self.graph_config

        if not self.node_data.start_node_id:
            raise ValueError(f"field start_node_id in iteration {self.node_id} not found")

        root_node_id = self.node_data.start_node_id

        # init graph
        iteration_graph = Graph.init(graph_config=graph_config, root_node_id=root_node_id)

        if not iteration_graph:
            raise ValueError("iteration graph not found")

        variable_pool = self.graph_runtime_state.variable_pool

        # append iteration variable (item, index) to variable pool
        variable_pool.add([self.node_id, "index"], 0)
        variable_pool.add([self.node_id, "item"], iterator_list_value[0])

        # init graph engine
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
            graph=iteration_graph,
            graph_config=graph_config,
            variable_pool=variable_pool,
            max_execution_steps=dify_config.WORKFLOW_MAX_EXECUTION_STEPS,
            max_execution_time=dify_config.WORKFLOW_MAX_EXECUTION_TIME,
        )

        start_at = datetime.now(timezone.utc).replace(tzinfo=None)

        yield IterationRunStartedEvent(
            iteration_id=self.id,
            iteration_node_id=self.node_id,
            iteration_node_type=self.node_type,
            iteration_node_data=self.node_data,
            start_at=start_at,
            inputs=inputs,
            metadata={"iterator_length": len(iterator_list_value)},
            predecessor_node_id=self.previous_node_id,
        )

        yield IterationRunNextEvent(
            iteration_id=self.id,
            iteration_node_id=self.node_id,
            iteration_node_type=self.node_type,
            iteration_node_data=self.node_data,
            index=0,
            pre_iteration_output=None,
        )

        outputs: list[Any] = []
        try:
            for _ in range(len(iterator_list_value)):
                # run workflow
                rst = graph_engine.run()
                for event in rst:
                    if isinstance(event, (BaseNodeEvent | BaseParallelBranchEvent)) and not event.in_iteration_id:
                        event.in_iteration_id = self.node_id

                    if (
                        isinstance(event, BaseNodeEvent)
                        and event.node_type == NodeType.ITERATION_START
                        and not isinstance(event, NodeRunStreamChunkEvent)
                    ):
                        continue

                    if isinstance(event, NodeRunSucceededEvent):
                        if event.route_node_state.node_run_result:
                            metadata = event.route_node_state.node_run_result.metadata
                            if not metadata:
                                metadata = {}

                            if NodeRunMetadataKey.ITERATION_ID not in metadata:
                                metadata[NodeRunMetadataKey.ITERATION_ID] = self.node_id
                                metadata[NodeRunMetadataKey.ITERATION_INDEX] = variable_pool.get_any(
                                    [self.node_id, "index"]
                                )
                                event.route_node_state.node_run_result.metadata = metadata

                        yield event
                    elif isinstance(event, BaseGraphEvent):
                        if isinstance(event, GraphRunFailedEvent):
                            # iteration run failed
                            yield IterationRunFailedEvent(
                                iteration_id=self.id,
                                iteration_node_id=self.node_id,
                                iteration_node_type=self.node_type,
                                iteration_node_data=self.node_data,
                                start_at=start_at,
                                inputs=inputs,
                                outputs={"output": jsonable_encoder(outputs)},
                                steps=len(iterator_list_value),
                                metadata={"total_tokens": graph_engine.graph_runtime_state.total_tokens},
                                error=event.error,
                            )

                            yield RunCompletedEvent(
                                run_result=NodeRunResult(
                                    status=WorkflowNodeExecutionStatus.FAILED,
                                    error=event.error,
                                )
                            )
                            return
                    else:
                        event = cast(InNodeEvent, event)
                        yield event

                # append to iteration output variable list
                current_iteration_output = variable_pool.get_any(self.node_data.output_selector)
                outputs.append(current_iteration_output)

                # remove all nodes outputs from variable pool
                for node_id in iteration_graph.node_ids:
                    variable_pool.remove_node(node_id)

                # move to next iteration
                current_index = variable_pool.get([self.node_id, "index"])
                if current_index is None:
                    raise ValueError(f"iteration {self.node_id} current index not found")

                next_index = int(current_index.to_object()) + 1
                variable_pool.add([self.node_id, "index"], next_index)

                if next_index < len(iterator_list_value):
                    variable_pool.add([self.node_id, "item"], iterator_list_value[next_index])

                yield IterationRunNextEvent(
                    iteration_id=self.id,
                    iteration_node_id=self.node_id,
                    iteration_node_type=self.node_type,
                    iteration_node_data=self.node_data,
                    index=next_index,
                    pre_iteration_output=jsonable_encoder(current_iteration_output)
                    if current_iteration_output
                    else None,
                )

            yield IterationRunSucceededEvent(
                iteration_id=self.id,
                iteration_node_id=self.node_id,
                iteration_node_type=self.node_type,
                iteration_node_data=self.node_data,
                start_at=start_at,
                inputs=inputs,
                outputs={"output": jsonable_encoder(outputs)},
                steps=len(iterator_list_value),
                metadata={"total_tokens": graph_engine.graph_runtime_state.total_tokens},
            )

            yield RunCompletedEvent(
                run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.SUCCEEDED, outputs={"output": jsonable_encoder(outputs)}
                )
            )
        except Exception as e:
            # iteration run failed
            logger.exception("Iteration run failed")
            yield IterationRunFailedEvent(
                iteration_id=self.id,
                iteration_node_id=self.node_id,
                iteration_node_type=self.node_type,
                iteration_node_data=self.node_data,
                start_at=start_at,
                inputs=inputs,
                outputs={"output": jsonable_encoder(outputs)},
                steps=len(iterator_list_value),
                metadata={"total_tokens": graph_engine.graph_runtime_state.total_tokens},
                error=str(e),
            )

            yield RunCompletedEvent(
                run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    error=str(e),
                )
            )
        finally:
            # remove iteration variable (item, index) from variable pool after iteration run completed
            variable_pool.remove([self.node_id, "index"])
            variable_pool.remove([self.node_id, "item"])

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls, graph_config: Mapping[str, Any], node_id: str, node_data: IterationNodeData
    ) -> Mapping[str, Sequence[str]]:
        """
        Extract variable selector to variable mapping
        :param graph_config: graph config
        :param node_id: node id
        :param node_data: node data
        :return:
        """
        variable_mapping = {
            f"{node_id}.input_selector": node_data.iterator_selector,
        }

        # init graph
        iteration_graph = Graph.init(graph_config=graph_config, root_node_id=node_data.start_node_id)

        if not iteration_graph:
            raise ValueError("iteration graph not found")

        for sub_node_id, sub_node_config in iteration_graph.node_id_config_mapping.items():
            if sub_node_config.get("data", {}).get("iteration_id") != node_id:
                continue

            # variable selector to variable mapping
            try:
                # Get node class
                from core.workflow.nodes.node_mapping import node_classes

                node_type = NodeType.value_of(sub_node_config.get("data", {}).get("type"))
                node_cls = node_classes.get(node_type)
                if not node_cls:
                    continue

                node_cls = cast(BaseNode, node_cls)

                sub_node_variable_mapping = node_cls.extract_variable_selector_to_variable_mapping(
                    graph_config=graph_config, config=sub_node_config
                )
                sub_node_variable_mapping = cast(dict[str, list[str]], sub_node_variable_mapping)
            except NotImplementedError:
                sub_node_variable_mapping = {}

            # remove iteration variables
            sub_node_variable_mapping = {
                sub_node_id + "." + key: value
                for key, value in sub_node_variable_mapping.items()
                if value[0] != node_id
            }

            variable_mapping.update(sub_node_variable_mapping)

        # remove variable out from iteration
        variable_mapping = {
            key: value for key, value in variable_mapping.items() if value[0] not in iteration_graph.node_ids
        }

        return variable_mapping
