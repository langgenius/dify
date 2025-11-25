from core.workflow.enums import NodeExecutionType, NodeType, WorkflowNodeExecutionStatus
from core.workflow.node_events import NodeRunResult
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.base.template import Template
from core.workflow.nodes.end.entities import EndNodeData


class EndNode(Node[EndNodeData]):
    node_type = NodeType.END
    execution_type = NodeExecutionType.RESPONSE

    @classmethod
    def version(cls) -> str:
        return "1"

    def _run(self) -> NodeRunResult:
        """
        Run node - collect all outputs at once.

        This method runs after streaming is complete (if streaming was enabled).
        It collects all output variables and returns them.
        """
        output_variables = self.node_data.outputs

        outputs = {}
        for variable_selector in output_variables:
            variable = self.graph_runtime_state.variable_pool.get(variable_selector.value_selector)
            value = variable.to_object() if variable is not None else None
            outputs[variable_selector.variable] = value

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs=outputs,
            outputs=outputs,
        )

    def get_streaming_template(self) -> Template:
        """
        Get the template for streaming.

        Returns:
            Template instance for this End node
        """
        outputs_config = [
            {"variable": output.variable, "value_selector": output.value_selector} for output in self.node_data.outputs
        ]
        return Template.from_end_outputs(outputs_config)
