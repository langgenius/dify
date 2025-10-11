from typing import Literal

from pydantic import BaseModel, field_validator

from core.rag.retrieval.retrieval_methods import RetrievalMethod


class IconInfo(BaseModel):
    icon: str
    icon_background: str | None = None
    icon_type: str | None = None
    icon_url: str | None = None


class PipelineTemplateInfoEntity(BaseModel):
    name: str
    description: str
    icon_info: IconInfo


class RagPipelineDatasetCreateEntity(BaseModel):
    name: str
    description: str
    icon_info: IconInfo
    permission: str
    partial_member_list: list[str] | None = None
    yaml_content: str | None = None


class RerankingModelConfig(BaseModel):
    """
    Reranking Model Config.
    """

    reranking_provider_name: str | None = ""
    reranking_model_name: str | None = ""


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

    vector_setting: VectorSetting | None
    keyword_setting: KeywordSetting | None


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

    search_method: RetrievalMethod
    top_k: int
    score_threshold: float | None = 0.5
    score_threshold_enabled: bool = False
    reranking_mode: str | None = "reranking_model"
    reranking_enable: bool | None = True
    reranking_model: RerankingModelConfig | None = None
    weights: WeightedScoreConfig | None = None


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
    keyword_number: int | None = 10
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
