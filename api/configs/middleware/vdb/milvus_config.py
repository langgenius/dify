from pydantic import Field
from pydantic_settings import BaseSettings


class MilvusConfig(BaseSettings):
    """
    Configuration settings for Milvus vector database
    """

    MILVUS_URI: str | None = Field(
        description="URI for connecting to the Milvus server (e.g., 'http://localhost:19530' or 'https://milvus-instance.example.com:19530')",
        default="http://127.0.0.1:19530",
    )

    MILVUS_TOKEN: str | None = Field(
        description="Authentication token for Milvus, if token-based authentication is enabled",
        default=None,
    )

    MILVUS_USER: str | None = Field(
        description="Username for authenticating with Milvus, if username/password authentication is enabled",
        default=None,
    )

    MILVUS_PASSWORD: str | None = Field(
        description="Password for authenticating with Milvus, if username/password authentication is enabled",
        default=None,
    )

    MILVUS_DATABASE: str = Field(
        description="Name of the Milvus database to connect to (default is 'default')",
        default="default",
    )

    MILVUS_ENABLE_HYBRID_SEARCH: bool = Field(
        description="Enable hybrid search features (requires Milvus >= 2.5.0). Set to false for compatibility with "
        "older versions",
        default=True,
    )

    MILVUS_ANALYZER_PARAMS: str | None = Field(
        description='Milvus text analyzer parameters, e.g., {"type": "chinese"} for Chinese segmentation support.',
        default=None,
    )
