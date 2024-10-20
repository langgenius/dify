from collections.abc import Sequence

from core.workflow.entities.base_node_data_entities import BaseNodeData


class DocumentExtractorNodeData(BaseNodeData):
    variable_selector: Sequence[str]
