from typing import Protocol


class PipelineDocumentStore(Protocol):
    """Document state required by a pipeline run, independent of its workflow session."""

    def exists(self, *, workspace_id: str, dataset_id: str, document_id: str) -> bool: ...

    def mark_failed(self, *, workspace_id: str, dataset_id: str, document_id: str, error: str) -> None: ...
