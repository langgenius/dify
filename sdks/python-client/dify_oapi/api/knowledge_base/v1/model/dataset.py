from __future__ import annotations
from pydantic import BaseModel


class Dataset(BaseModel):
    id: str | None = None
    name: str | None = None
    description: str | None = None
    provider: str | None = None
    permission: str | None = None
    data_source_type: str | None = None
    indexing_technique: str | None = None
    app_count: int | None = None
    document_count: int | None = None
    word_count: int | None = None
    created_by: str | None = None
    created_at: int | None = None
    updated_by: str | None = None
    updated_at: int | None = None
    embedding_model: str | None = None
    embedding_model_provider: str | None = None
    embedding_available: bool | None = None
    retrieval_model_dict: DatasetResponseRetrievalModel | None = None
    tags: list | None = None
    external_knowledge_info: DatasetResponseExternalKnowledgeInfo | None = None
    external_retrieval_model: DatasetResponseExternalRetrievalModel | None = None


class DatasetResponseRetrievalModel(BaseModel):
    search_method: str | None = None
    reranking_enable: bool | None = None
    reranking_mode: str | None = None
    reranking_model: DatasetResponseRerankingModel | None = None
    weights: float | None = None
    top_k: int | None = None
    score_threshold_enabled: bool | None = None
    score_threshold: float | None = None


class DatasetResponseRerankingModel(BaseModel):
    reranking_provider_name: str | None = None
    reranking_model_name: str | None = None


class DatasetResponseExternalKnowledgeInfo(BaseModel):
    external_knowledge_id: str | None = None
    external_knowledge_api_id: str | None = None
    external_knowledge_api_name: str | None = None
    external_knowledge_api_endpoint: str | None = None


class DatasetResponseExternalRetrievalModel(BaseModel):
    top_k: int | None = None
    score_threshold: float | None = None
