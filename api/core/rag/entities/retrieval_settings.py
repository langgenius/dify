from pydantic import BaseModel


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
