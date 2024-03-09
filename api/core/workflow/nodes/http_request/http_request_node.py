from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.node_entities import NodeRunResult, NodeType
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.base_node import BaseNode
from core.workflow.nodes.http_request.entities import HttpRequestNodeData

class HttpRequestNode(BaseNode):
    _node_data_cls = HttpRequestNodeData
    node_type = NodeType.HTTP_REQUEST

    def _run(self, variable_pool: VariablePool) -> NodeRunResult:
        pass

    @classmethod
    def _extract_variable_selector_to_variable_mapping(cls, node_data: BaseNodeData) -> dict[list[str], str]:
        """
        Extract variable selector to variable mapping
        :param node_data: node data
        :return:
        """
        pass