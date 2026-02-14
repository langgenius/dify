from collections.abc import Sequence

from core.workflow.enums import NodeType
from core.workflow.nodes.base import BaseNodeData


class DocumentExtractorNodeData(BaseNodeData):
    type: NodeType = NodeType.DOCUMENT_EXTRACTOR
    variable_selector: Sequence[str]
