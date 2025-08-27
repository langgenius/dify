from typing import Literal, Optional

from pydantic import BaseModel, field_validator


class IconInfo(BaseModel):
    icon: str
    icon_background: Optional[str] = None
    icon_type: Optional[str] = None
    icon_url: Optional[str] = None


class PipelineTemplateInfoEntity(BaseModel):
    name: str
    description: str
    icon_info: IconInfo


class RagPipelineDatasetCreateEntity(BaseModel):
    name: str
    description: str
    icon_info: IconInfo
    permission: str
    partial_member_list: Optional[list[str]] = None
    yaml_content: Optional[str] = None


class RerankingModelConfig(BaseModel):
    """
    Reranking Model Config.
    """

    reranking_provider_name: Optional[str] = ""
    reranking_model_name: Optional[str] = ""


class VectorSetting(BaseModel):
    """
    Vector Setting.
    """

    vector_weight: float
    embedding_provider_name: str
    embedding_model_name: str


class KeywordSetting(BaseModel):
    """
    Keyword Setting.
    """

    keyword_weight: float


class WeightedScoreConfig(BaseModel):
    """
    Weighted score Config.
    """

    vector_setting: Optional[VectorSetting]
    keyword_setting: Optional[KeywordSetting]


class EmbeddingSetting(BaseModel):
    """
    Embedding Setting.
    """

    embedding_provider_name: str
    embedding_model_name: str


class EconomySetting(BaseModel):
    """
    Economy Setting.
    """

    keyword_number: int


class RetrievalSetting(BaseModel):
    """
    Retrieval Setting.
    """

    search_method: Literal["semantic_search", "fulltext_search", "keyword_search", "hybrid_search"]
    top_k: int
    score_threshold: Optional[float] = 0.5
    score_threshold_enabled: bool = False
    reranking_mode: Optional[str] = "reranking_model"
    reranking_enable: Optional[bool] = True
    reranking_model: Optional[RerankingModelConfig] = None
    weights: Optional[WeightedScoreConfig] = None


class IndexMethod(BaseModel):
    """
    Knowledge Index Setting.
    """

    indexing_technique: Literal["high_quality", "economy"]
    embedding_setting: EmbeddingSetting
    economy_setting: EconomySetting


class KnowledgeConfiguration(BaseModel):
    """
    Knowledge Base Configuration.
    """

    chunk_structure: str
    indexing_technique: Literal["high_quality", "economy"]
    embedding_model_provider: str = ""
    embedding_model: str = ""
    keyword_number: Optional[int] = 10
    retrieval_model: RetrievalSetting

    @field_validator("embedding_model_provider", mode="before")
    @classmethod
    def validate_embedding_model_provider(cls, v):
        if v is None:
            return ""
        return v

    @field_validator("embedding_model", mode="before")
    @classmethod
    def validate_embedding_model(cls, v):
        if v is None:
            return ""
        return v
