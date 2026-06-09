from pydantic import BaseModel

from core.rag.entities import KeywordSetting, VectorSetting


class Weights(BaseModel):
    """Model for weighted rerank."""

    vector_setting: VectorSetting

    keyword_setting: KeywordSetting
