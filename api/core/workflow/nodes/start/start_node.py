from core.workflow.constants import SYSTEM_VARIABLE_NODE_ID
from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.enums import NodeType
from core.workflow.nodes.start.entities import StartNodeData
from models.workflow import WorkflowNodeExecutionStatus


class StartNode(BaseNode[StartNodeData]):
    _node_data_cls = StartNodeData
    _node_type = NodeType.START

    def _run(self) -> NodeRunResult:
        node_inputs = dict(self.graph_runtime_state.variable_pool.user_inputs)
        system_inputs = self.graph_runtime_state.variable_pool.system_variables

        # TODO: System variables should be directly accessible, no need for special handling
        # Set system variables as node outputs.
        for var in system_inputs:
            node_inputs[SYSTEM_VARIABLE_NODE_ID + "." + var] = system_inputs[var]

        return NodeRunResult(status=WorkflowNodeExecutionStatus.SUCCEEDED, inputs=node_inputs, outputs=node_inputs)
