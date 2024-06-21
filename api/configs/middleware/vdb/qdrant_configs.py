from typing import Optional

from pydantic import BaseModel, Field, NonNegativeInt, PositiveInt


class QdrantConfigs(BaseModel):
    """
    Qdrant configs
    """

    QDRANT_URL: Optional[str] = Field(
        description='Qdrant url',
        default=None,
    )

    QDRANT_API_KEY: Optional[str] = Field(
        description='Qdrant api key',
        default=None,
    )

    QDRANT_CLIENT_TIMEOUT: NonNegativeInt = Field(
        description='Qdrant client timeout in seconds',
        default=20,
    )

    QDRANT_GRPC_ENABLED: bool = Field(
        description='whether enable grpc support for Qdrant connection',
        default=False,
    )

    QDRANT_GRPC_PORT: PositiveInt = Field(
        description='Qdrant grpc port',
        default=6334,
    )
