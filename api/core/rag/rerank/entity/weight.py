from pydantic import BaseModel

from services.knowledge.entities.retrieval_settings import KeywordSetting, VectorSetting


class Weights(BaseModel):
    """Model for weighted rerank."""

    vector_setting: VectorSetting

    keyword_setting: KeywordSetting
