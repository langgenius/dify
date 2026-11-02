from pydantic import Field, NonNegativeInt, PositiveInt
from pydantic_settings import BaseSettings


class QdrantConfig(BaseSettings):
    """
    Configuration settings for Qdrant vector database
    """

    QDRANT_URL: str | None = Field(
        description="URL of the Qdrant server (e.g., 'http://localhost:6333' or 'https://qdrant.example.com')",
        default=None,
    )

    QDRANT_API_KEY: str | None = Field(
        description="API key for authenticating with the Qdrant server",
        default=None,
    )

    QDRANT_CLIENT_TIMEOUT: NonNegativeInt = Field(
        description="Timeout in seconds for Qdrant client operations (default is 20 seconds)",
        default=20,
    )

    QDRANT_GRPC_ENABLED: bool = Field(
        description="Whether to enable gRPC support for Qdrant connection (True for gRPC, False for HTTP)",
        default=False,
    )

    QDRANT_GRPC_PORT: PositiveInt = Field(
        description="Port number for gRPC connection to Qdrant server (default is 6334)",
        default=6334,
    )

    QDRANT_REPLICATION_FACTOR: PositiveInt = Field(
        description="Replication factor for Qdrant collections (default is 1)",
        default=1,
    )
