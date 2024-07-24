from pydantic import BaseModel


class VectorSetting(BaseModel):
    vector_weight: float

    embedding_provider_name: str

    embedding_model_name: str


class KeywordSetting(BaseModel):
    keyword_weight: float


class Weights(BaseModel):
    """Model for weighted rerank."""

    weight_type: str

    vector_setting: VectorSetting

    keyword_setting: KeywordSetting
