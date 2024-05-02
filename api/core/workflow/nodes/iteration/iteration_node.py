from typing import Union, cast

from core.model_runtime.utils.encoders import jsonable_encoder
from core.workflow.entities.base_node_data_entities import BaseIterationState
from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.base_node import BaseIterationNode
from core.workflow.nodes.iteration.entities import IterationNodeData, IterationState
from models.workflow import WorkflowNodeExecutionStatus


class IterationNode(BaseIterationNode):
    """
    Iteration Node.
    """
    _node_data_cls = IterationNodeData
    _node_type = NodeType.ITERATION

    def _run(self, variable_pool: VariablePool) -> BaseIterationState:
        """
        Run the node.
        """
        self._set_current_iteration_variable(variable_pool)
        return IterationState(iteration_node_id=self.node_id, index=0, outputs=[])

    def _get_next_iteration_start_id(self, variable_pool: VariablePool, state: IterationState) -> Union[NodeRunResult, str]:
        """
        Get next iteration start node id based on the graph.
        :param graph: graph
        :return: next node id
        """
        # resolve current output
        self._resolve_current_output(variable_pool)
        # move to next iteration
        self._next_iteration(variable_pool)

        node_data = cast(IterationNodeData, self.node_data)
        if self._reached_iteration_limit():
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                outputs={
                    'output': jsonable_encoder(state.outputs)
                }
            )
        
        return node_data.start_node_id

    def _set_current_iteration_variable(self, variable_pool: VariablePool, state: IterationState):
        """
        Set current iteration variable.
        :variable_pool: variable pool
        """
        node_data = cast(IterationNodeData, self.node_data)

        variable_pool.append_variable(self.node_id, ['index'], state.index)
        # get the iterator value
        iterator = variable_pool.get_variable_value(node_data.iterator_selector)

        if iterator is None or not isinstance(iterator, list):
            return
        
        if state.index < len(iterator):
            variable_pool.append_variable(self.node_id, ['item'], iterator[state.index])

    def _next_iteration(self, variable_pool: VariablePool, state: IterationState):
        """
        Move to next iteration.
        :param variable_pool: variable pool
        """
        state.index += 1
        self._set_current_iteration_variable(variable_pool)

    def _reached_iteration_limit(self, state: IterationState):
        """
        Check if iteration limit is reached.
        :return: True if iteration limit is reached, False otherwise
        """
        node_data = cast(IterationNodeData, self.node_data)
        iterator = node_data.iterator_selector

        if iterator is None or not isinstance(iterator, list):
            return True

        return state.index >= len(iterator)
    
    def _resolve_current_output(self, variable_pool: VariablePool, state: IterationState):
        """
        Resolve current output.
        :param variable_pool: variable pool
        """
        output_selector = cast(IterationNodeData, self.node_data).output_selector
        output = variable_pool.get_variable_value(output_selector)
        # clear the output for this iteration
        variable_pool.append_variable(self.node_id, output_selector[1:], None)
        if output is not None:
            state.outputs.append(output)
