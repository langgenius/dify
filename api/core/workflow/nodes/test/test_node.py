
from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.nodes.base_node import BaseNode
from core.workflow.nodes.test.entities import TestNodeData
from models.workflow import WorkflowNodeExecutionStatus


class TestNode(BaseNode):
    _node_data_cls = TestNodeData
    node_type = NodeType.ANSWER

    def _run(self) -> NodeRunResult:
        """
        Run node
        :return:
        """
        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            outputs={
                "content": "abc"
            },
            edge_source_handle="1"
        )

    @classmethod
    def _extract_variable_selector_to_variable_mapping(cls, node_data: BaseNodeData) -> dict[str, list[str]]:
        """
        Extract variable selector to variable mapping
        :param node_data: node data
        :return:
        """
        return {}
