import logging
from typing import Any, cast

from configs import dify_config
from core.model_runtime.utils.encoders import jsonable_encoder
from core.workflow.entities.base_node_data_entities import BaseIterationState
from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.graph_engine.entities.event import BaseGraphEvent, GraphRunFailedEvent, NodeRunSucceededEvent, \
    IterationRunStartedEvent, IterationRunSucceededEvent, IterationRunFailedEvent, IterationRunNextEvent
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.graph_engine.entities.run_condition import RunCondition
from core.workflow.nodes.base_node import BaseNode
from core.workflow.nodes.event import RunCompletedEvent
from core.workflow.nodes.iteration.entities import IterationNodeData
from core.workflow.utils.condition.entities import Condition
from models.workflow import WorkflowNodeExecutionStatus

logger = logging.getLogger(__name__)


class IterationNode(BaseNode):
    """
    Iteration Node.
    """
    _node_data_cls = IterationNodeData
    _node_type = NodeType.ITERATION

    def _run(self) -> BaseIterationState:
        """
        Run the node.
        """
        self.node_data = cast(IterationNodeData, self.node_data)
        iterator_list_value = self.graph_runtime_state.variable_pool.get_any(self.node_data.iterator_selector)

        if not isinstance(iterator_list_value, list):
            raise ValueError(f"Invalid iterator value: {iterator_list_value}, please provide a list.")

        root_node_id = self.node_data.start_node_id
        graph_config = self.graph_config

        # init graph
        iteration_graph = Graph.init(
            graph_config=graph_config,
            root_node_id=root_node_id
        )

        if not iteration_graph:
            raise ValueError('iteration graph not found')

        leaf_node_ids = iteration_graph.get_leaf_node_ids()
        iteration_leaf_node_ids = []
        for leaf_node_id in leaf_node_ids:
            node_config = iteration_graph.node_id_config_mapping.get(leaf_node_id)
            if not node_config:
                continue

            leaf_node_iteration_id = node_config.get("data", {}).get("iteration_id")
            if not leaf_node_iteration_id:
                continue

            if leaf_node_iteration_id != self.node_id:
                continue

            iteration_leaf_node_ids.append(leaf_node_id)

            # add condition of end nodes to root node
            iteration_graph.add_extra_edge(
                source_node_id=leaf_node_id,
                target_node_id=root_node_id,
                run_condition=RunCondition(
                    type="condition",
                    conditions=[
                        Condition(
                            variable_selector=[self.node_id, "index"],
                            comparison_operator="<",
                            value=str(len(iterator_list_value))
                        )
                    ]
                )
            )

        variable_pool = self.graph_runtime_state.variable_pool

        # append iteration variable (item, index) to variable pool
        variable_pool.add(
            [self.node_id, 'index'],
            0
        )
        variable_pool.add(
            [self.node_id, 'item'],
            iterator_list_value[0]
        )

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
            max_execution_time=dify_config.WORKFLOW_MAX_EXECUTION_TIME
        )

        yield IterationRunStartedEvent(
            iteration_id=self.node_id,
        )

        yield IterationRunNextEvent(
            iteration_id=self.node_id,
            index=0,
            output=None
        )

        try:
            # run workflow
            rst = graph_engine.run()
            outputs: list[Any] = []
            for event in rst:
                if isinstance(event, NodeRunSucceededEvent):
                    yield event

                    # handle iteration run result
                    if event.route_node_state.node_id in iteration_leaf_node_ids:
                        # append to iteration output variable list
                        current_iteration_output = variable_pool.get_any(self.node_data.output_selector)
                        outputs.append(current_iteration_output)

                        # remove all nodes outputs from variable pool
                        for node_id in iteration_graph.node_ids:
                            variable_pool.remove_node(node_id)

                        # move to next iteration
                        next_index = variable_pool.get_any([self.node_id, 'index']) + 1
                        variable_pool.add(
                            [self.node_id, 'index'],
                            next_index
                        )

                        if next_index < len(iterator_list_value):
                            variable_pool.add(
                                [self.node_id, 'item'],
                                iterator_list_value[next_index]
                            )

                        yield IterationRunNextEvent(
                            iteration_id=self.node_id,
                            index=next_index,
                            pre_iteration_output=jsonable_encoder(current_iteration_output) if current_iteration_output else None
                        )
                elif isinstance(event, BaseGraphEvent):
                    if isinstance(event, GraphRunFailedEvent):
                        # iteration run failed
                        yield IterationRunFailedEvent(
                            iteration_id=self.node_id,
                            reason=event.reason,
                        )

                        yield RunCompletedEvent(
                            run_result=NodeRunResult(
                                status=WorkflowNodeExecutionStatus.FAILED,
                                error=event.reason,
                            )
                        )
                        break
                else:
                    yield event

            yield IterationRunSucceededEvent(
                iteration_id=self.node_id,
            )

            yield RunCompletedEvent(
                run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.SUCCEEDED,
                    outputs={
                        'output': jsonable_encoder(outputs)
                    }
                )
            )
        except Exception as e:
            # iteration run failed
            logger.exception("Iteration run failed")
            yield IterationRunFailedEvent(
                iteration_id=self.node_id,
                reason=str(e),
            )

            yield RunCompletedEvent(
                run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    error=str(e),
                )
            )
        finally:
            # remove iteration variable (item, index) from variable pool after iteration run completed
            variable_pool.remove([self.node_id, 'index'])
            variable_pool.remove([self.node_id, 'item'])

    @classmethod
    def _extract_variable_selector_to_variable_mapping(cls, node_data: IterationNodeData) -> dict[str, list[str]]:
        """
        Extract variable selector to variable mapping
        :param node_data: node data
        :return:
        """
        return {
            'input_selector': node_data.iterator_selector,
        }
