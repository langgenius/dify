from collections.abc import Sequence
from dataclasses import dataclass

from core.workflow.nodes.base import BaseNodeData


class DocumentExtractorNodeData(BaseNodeData):
    variable_selector: Sequence[str]


@dataclass(frozen=True)
class UnstructuredApiConfig:
    api_url: str | None = None
    api_key: str = ""
