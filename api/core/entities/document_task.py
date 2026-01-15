from collections.abc import Sequence
from dataclasses import dataclass


@dataclass
class DocumentTask:
    """Document task entity for document indexing operations.

    This class represents a document indexing task that can be queued
    and processed by the document indexing system.
    """

    tenant_id: str
    dataset_id: str
    document_ids: Sequence[str]
