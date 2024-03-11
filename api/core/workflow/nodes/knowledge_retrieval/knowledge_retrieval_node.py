from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.base_node import BaseNode


class KnowledgeRetrievalNode(BaseNode):
    def _run(self, variable_pool: VariablePool) -> NodeRunResult:
        pass

    @classmethod
    def _extract_variable_selector_to_variable_mapping(cls, node_data: BaseNodeData) -> dict[str, list[str]]:
        pass
