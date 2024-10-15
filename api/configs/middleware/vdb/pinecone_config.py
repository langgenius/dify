from typing import Optional

from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class PineconeConfig(BaseSettings):
    """
    Configuration settings for Pinecone vector database.
    Only support serverless index yet.
    """

    PINECONE_INDEX: Optional[str] = Field(
        description="The pinecone index name.",
        default="default_index_name",
    )

    PINECONE_INDEX_DIMENSION: PositiveInt = Field(
        description="The pinecone index dimension.",
        default=768,
    )

    PINECONE_API_KEY: Optional[str] = Field(
        description="The pinecone API key. You can get it from "
        "https://docs.pinecone.io/guides/get-started/quickstart#1-get-an-api-key",
        default=None,
    )
