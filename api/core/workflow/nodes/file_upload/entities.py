from collections.abc import Sequence

from dify_graph.nodes.base import BaseNodeData


class FileUploadNodeData(BaseNodeData):
    variable_selector: Sequence[str]
