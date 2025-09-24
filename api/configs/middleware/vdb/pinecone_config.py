from typing import Optional

from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class PineconeConfig(BaseSettings):
    """
    Configuration settings for Pinecone vector database
    """

    PINECONE_API_KEY: Optional[str] = Field(
        description="API key for authenticating with Pinecone service",
        default=None,
    )

    PINECONE_ENVIRONMENT: Optional[str] = Field(
        description="Pinecone environment (e.g., 'us-west1-gcp', 'us-east-1-aws')",
        default=None,
    )

    PINECONE_INDEX_NAME: Optional[str] = Field(
        description="Default Pinecone index name",
        default=None,
    )

    PINECONE_CLIENT_TIMEOUT: PositiveInt = Field(
        description="Timeout in seconds for Pinecone client operations (default is 30 seconds)",
        default=30,
    )

    PINECONE_BATCH_SIZE: PositiveInt = Field(
        description="Batch size for Pinecone operations (default is 100)",
        default=100,
    )

    PINECONE_METRIC: str = Field(
        description="Distance metric for Pinecone index (cosine, euclidean, dotproduct)",
        default="cosine",
    )