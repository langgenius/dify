from collections.abc import Sequence
from dataclasses import dataclass

from graphon.entities.base_node_data import BaseNodeData
from graphon.enums import BuiltinNodeTypes, NodeType


class DocumentExtractorNodeData(BaseNodeData):
    type: NodeType = BuiltinNodeTypes.DOCUMENT_EXTRACTOR
    variable_selector: Sequence[str]


@dataclass(frozen=True)
class UnstructuredApiConfig:
    api_url: str | None = None
    api_key: str = ""
