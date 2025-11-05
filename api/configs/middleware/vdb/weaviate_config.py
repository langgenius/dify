from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class WeaviateConfig(BaseSettings):
    """
    Configuration settings for Weaviate vector database
    """

    WEAVIATE_ENDPOINT: str | None = Field(
        description="URL of the Weaviate server (e.g., 'http://localhost:8080' or 'https://weaviate.example.com')",
        default=None,
    )

    WEAVIATE_API_KEY: str | None = Field(
        description="API key for authenticating with the Weaviate server",
        default=None,
    )

    WEAVIATE_GRPC_ENABLED: bool = Field(
        description="Whether to enable gRPC for Weaviate connection (True for gRPC, False for HTTP)",
        default=True,
    )

    WEAVIATE_GRPC_ENDPOINT: str | None = Field(
        description="URL of the Weaviate gRPC server (e.g., 'localhost:50051' or 'grpc.weaviate.example.com:443'). If not provided, will be inferred from WEAVIATE_ENDPOINT",
        default=None,
    )

    WEAVIATE_BATCH_SIZE: PositiveInt = Field(
        description="Number of objects to be processed in a single batch operation (default is 100)",
        default=100,
    )