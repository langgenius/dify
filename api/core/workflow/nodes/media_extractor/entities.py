from collections.abc import Sequence

from core.workflow.nodes.base import BaseNodeData


class MediaExtractorNodeData(BaseNodeData):
    variable_selector: Sequence[str]
    variable_config: dict
