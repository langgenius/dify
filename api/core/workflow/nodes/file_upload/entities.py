from collections.abc import Sequence

from dify_graph.entities.base_node_data import BaseNodeData


class FileUploadNodeData(BaseNodeData):
    variable_selector: Sequence[str]
