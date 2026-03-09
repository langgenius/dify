from collections.abc import Sequence
from dataclasses import dataclass

from dify_graph.enums import NodeType
from dify_graph.entities.base_node_data import BaseNodeData


class DocumentExtractorNodeData(BaseNodeData):
    type: NodeType = NodeType.DOCUMENT_EXTRACTOR
    variable_selector: Sequence[str]


@dataclass(frozen=True)
class UnstructuredApiConfig:
    api_url: str | None = None
    api_key: str = ""
