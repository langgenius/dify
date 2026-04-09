from collections.abc import Sequence

from graphon.entities.base_node_data import BaseNodeData


class FileUploadNodeData(BaseNodeData):
    variable_selector: Sequence[str]
