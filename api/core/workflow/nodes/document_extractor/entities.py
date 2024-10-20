from collections.abc import Sequence

from core.workflow.nodes.base import BaseNodeData


class DocumentExtractorNodeData(BaseNodeData):
    variable_selector: Sequence[str]
