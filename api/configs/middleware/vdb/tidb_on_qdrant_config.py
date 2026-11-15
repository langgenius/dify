from pydantic import Field, NonNegativeInt, PositiveInt
from pydantic_settings import BaseSettings


class TidbOnQdrantConfig(BaseSettings):
    """
    Tidb on Qdrant configs
    """

    TIDB_ON_QDRANT_URL: str | None = Field(
        description="Tidb on Qdrant url",
        default=None,
    )

    TIDB_ON_QDRANT_API_KEY: str | None = Field(
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

    TIDB_ON_QDRANT_ESTIMATED_STORAGE_LIMITS_MB: str = Field(
        description="Cloud pre-write thresholds for projected TiDB vector storage usage, in plan:MB pairs.",
        default="sandbox:60,professional:6400,team:25600",
    )

    TIDB_PUBLIC_KEY: str | None = Field(
        description="Tidb account public key",
        default=None,
    )

    TIDB_PRIVATE_KEY: str | None = Field(
        description="Tidb account private key",
        default=None,
    )

    TIDB_API_URL: str | None = Field(
        description="Tidb API url",
        default=None,
    )

    TIDB_IAM_API_URL: str | None = Field(
        description="Tidb IAM API url",
        default=None,
    )

    TIDB_REGION: str | None = Field(
        description="Tidb serverless region",
        default="regions/aws-us-east-1",
    )

    TIDB_PROJECT_ID: str | None = Field(
        description="Tidb project id",
        default=None,
    )

    TIDB_SPEND_LIMIT: int | None = Field(
        description="Tidb spend limit",
        default=100,
    )
