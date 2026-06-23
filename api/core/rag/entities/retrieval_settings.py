from pydantic import BaseModel, ConfigDict, Field


class RerankingModelConfig(BaseModel):
    """
    Canonical reranking model configuration.

    Accepts both naming conventions:
    - reranking_provider_name / reranking_model_name (services layer)
    - provider / model (workflow layer via validation_alias)
    """

    model_config = ConfigDict(populate_by_name=True)

    reranking_provider_name: str = Field(validation_alias="provider")
    reranking_model_name: str = Field(validation_alias="model")

    @property
    def provider(self) -> str:
        return self.reranking_provider_name

    @property
    def model(self) -> str:
        return self.reranking_model_name


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

    vector_setting: VectorSetting
    keyword_setting: KeywordSetting
