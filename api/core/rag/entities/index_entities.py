from typing import Literal

from pydantic import BaseModel


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


class IndexMethod(BaseModel):
    """
    Knowledge Index Setting.
    """

    indexing_technique: Literal["high_quality", "economy"]
    embedding_setting: EmbeddingSetting
    economy_setting: EconomySetting
