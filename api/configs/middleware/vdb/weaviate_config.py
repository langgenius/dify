from typing import Optional

from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class WeaviateConfig(BaseSettings):
    """
    Weaviate configs
    """

    WEAVIATE_ENDPOINT: Optional[str] = Field(
        description="Weaviate endpoint URL",
        default=None,
    )

    WEAVIATE_API_KEY: Optional[str] = Field(
        description="Weaviate API key",
        default=None,
    )

    WEAVIATE_GRPC_ENABLED: bool = Field(
        description="whether to enable gRPC for Weaviate connection",
        default=True,
    )

    WEAVIATE_BATCH_SIZE: PositiveInt = Field(
        description="Weaviate batch size",
        default=100,
    )
