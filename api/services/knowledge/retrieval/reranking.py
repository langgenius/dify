"""Rank materialized retrieval results without retaining database resources."""

from functools import partial
from typing import Protocol

from core.rag.data_post_processor.data_post_processor import DataPostProcessor, RerankingModelDict, WeightsDict
from core.rag.extractor.entity.extract_setting import UploadFileExtractionInput
from core.rag.index_processor.constant.query_type import QueryType
from core.rag.models.document import Document


class RetrievalUploads(Protocol):
    def get_by_id(self, file_id: str, *, workspace_id: str) -> UploadFileExtractionInput | None: ...


class KnowledgeReranker:
    def __init__(self, uploads: RetrievalUploads) -> None:
        self._uploads = uploads

    def __call__(
        self,
        *,
        tenant_id: str,
        reranking_mode: str,
        reranking_model: RerankingModelDict | None,
        weights: WeightsDict | None,
        documents: list[Document],
        query: str | None,
        attachment_id: str | None,
        score_threshold: float,
        top_k: int,
    ) -> list[Document]:
        processor = DataPostProcessor(
            tenant_id,
            reranking_mode,
            reranking_model,
            weights,
            False,
            load_upload=partial(self._uploads.get_by_id, workspace_id=tenant_id),
        )
        if query:
            documents = processor.invoke(
                query=query,
                documents=documents,
                score_threshold=score_threshold,
                top_n=top_k,
                query_type=QueryType.TEXT_QUERY,
            )
        if attachment_id:
            documents = processor.invoke(
                query=attachment_id,
                documents=documents,
                score_threshold=score_threshold,
                top_n=top_k,
                query_type=QueryType.IMAGE_QUERY,
            )
        return documents
