import math
from collections.abc import Sequence
from dataclasses import dataclass

from graphon.entities.base_node_data import BaseNodeData
from graphon.enums import BuiltinNodeTypes, NodeType

_MAX_UNSTRUCTURED_API_TIMEOUT_SECONDS = 3600.0


class DocumentExtractorNodeData(BaseNodeData):
    type: NodeType = BuiltinNodeTypes.DOCUMENT_EXTRACTOR
    variable_selector: Sequence[str]


@dataclass(frozen=True)
class UnstructuredApiConfig:
    api_url: str | None = None
    api_key: str = ""
    timeout_seconds: float = 300.0

    def __post_init__(self) -> None:
        timeout_seconds = self.timeout_seconds
        if (
            not math.isfinite(timeout_seconds)
            or timeout_seconds <= 0
            or timeout_seconds > _MAX_UNSTRUCTURED_API_TIMEOUT_SECONDS
        ):
            msg = "timeout_seconds must be finite and in the range (0, 3600]"
            raise ValueError(msg)
