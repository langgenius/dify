from collections.abc import Sequence

from core.workflow.nodes.base import BaseNodeData


class FileUploadNodeData(BaseNodeData):
    variable_selector: Sequence[str]
