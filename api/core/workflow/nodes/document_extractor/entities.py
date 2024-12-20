from collections.abc import Sequence
from typing import Optional

from core.workflow.nodes.base import BaseNodeData


class DocumentExtractorNodeData(BaseNodeData):
    variable_selector: Sequence[str]
    output_image: Optional[bool] = False
