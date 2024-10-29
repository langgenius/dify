from typing import Optional

from pydantic import Field, NonNegativeInt, PositiveInt
from pydantic_settings import BaseSettings


class TidbOnQdrantConfig(BaseSettings):
    """
    Tidb on Qdrant configs
    """

    TIDB_ON_QDRANT_URL: Optional[str] = Field(
        description="Tidb on Qdrant url",
        default=None,
    )

    TIDB_ON_QDRANT_API_KEY: Optional[str] = Field(
        description="Tidb on Qdrant api key",
        default=None,
    )

    TIDB_ON_QDRANT_CLIENT_TIMEOUT: NonNegativeInt = Field(
        description="Tidb on Qdrant client timeout in seconds",
        default=20,
    )

    TIDB_ON_QDRANT_GRPC_ENABLED: bool = Field(
        description="whether enable grpc support for Tidb on Qdrant connection",
        default=False,
    )

    TIDB_ON_QDRANT_GRPC_PORT: PositiveInt = Field(
        description="Tidb on Qdrant grpc port",
        default=6334,
    )

    TIDB_PUBLIC_KEY: Optional[str] = Field(
        description="Tidb account public key",
        default=None,
    )

    TIDB_PRIVATE_KEY: Optional[str] = Field(
        description="Tidb account private key",
        default=None,
    )

    TIDB_API_URL: Optional[str] = Field(
        description="Tidb API url",
        default=None,
    )

    TIDB_IAM_API_URL: Optional[str] = Field(
        description="Tidb IAM API url",
        default=None,
    )

    TIDB_REGION: Optional[str] = Field(
        description="Tidb serverless region",
        default="regions/aws-us-east-1",
    )

    TIDB_PROJECT_ID: Optional[str] = Field(
        description="Tidb project id",
        default=None,
    )
