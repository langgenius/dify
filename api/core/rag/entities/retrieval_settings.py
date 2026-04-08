from pydantic import BaseModel, ConfigDict, Field, field_validator


class RerankingModelConfig(BaseModel):
    """
    Canonical reranking model configuration.

    Accepts both naming conventions:
    - reranking_provider_name / reranking_model_name (services layer)
    - provider / model (workflow layer via validation_alias)
    """

    model_config = ConfigDict(populate_by_name=True)

    reranking_provider_name: str | None = Field(default="", validation_alias="provider")
    reranking_model_name: str | None = Field(default="", validation_alias="model")

    @field_validator("reranking_provider_name", mode="before")
    @classmethod
    def coerce_provider(cls, v: str | None) -> str:
        return v if v is not None else ""

    @field_validator("reranking_model_name", mode="before")
    @classmethod
    def coerce_model(cls, v: str | None) -> str:
        return v if v is not None else ""

    @property
    def provider(self) -> str:
        return self.reranking_provider_name or ""

    @property
    def model(self) -> str:
        return self.reranking_model_name or ""


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

    vector_setting: VectorSetting | None = None
    keyword_setting: KeywordSetting | None = None
