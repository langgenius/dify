from collections.abc import Mapping
from typing import Any, Protocol

from pydantic import BaseModel, Field


class PreviewItem(BaseModel):
    content: str | None = Field(None)
    child_chunks: list[str] | None = Field(None)
    summary: str | None = Field(None)


class QaPreview(BaseModel):
    answer: str | None = Field(None)
    question: str | None = Field(None)


class Preview(BaseModel):
    chunk_structure: str
    parent_mode: str | None = Field(None)
    preview: list[PreviewItem] = Field([])
    qa_preview: list[QaPreview] = Field([])
    total_segments: int


class IndexProcessorProtocol(Protocol):
    def format_preview(self, chunk_structure: str, chunks: Any) -> Preview: ...

    def index_and_clean(
        self,
        dataset_id: str,
        document_id: str,
        original_document_id: str,
        chunks: Mapping[str, Any],
        batch: Any,
        summary_index_setting: dict | None = None,
    ) -> dict[str, Any]: ...

    def get_preview_output(
        self, chunks: Any, dataset_id: str, document_id: str, chunk_structure: str, summary_index_setting: dict | None
    ) -> Preview: ...
