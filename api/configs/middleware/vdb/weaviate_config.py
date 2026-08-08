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

    WEAVIATE_GRPC_ENDPOINT: str | None = Field(
        description="URL of the Weaviate gRPC server (e.g., 'grpc://localhost:50051' or 'grpcs://weaviate.example.com:443')",
        default=None,
    )

    WEAVIATE_BATCH_SIZE: PositiveInt = Field(
        description="Number of objects to be processed in a single batch operation (default is 100)",
        default=100,
    )

    WEAVIATE_TOKENIZATION: str | None = Field(
        description="Tokenization for Weaviate (default is word)",
        default="word",
    )

    WEAVIATE_MULTI_TENANCY_ENABLED: bool = Field(
        description="Enable Weaviate native multi-tenancy. When true, datasets sharing an embedding model are "
        "stored as isolated tenants within a single shared collection instead of one collection per dataset. "
        "Opt-in; only affects datasets created while enabled (existing datasets keep their persisted layout).",
        default=False,
    )

    WEAVIATE_INDEX_TYPE: str = Field(
        description="Vector index type for new collections: 'hnsw', 'flat', or 'dynamic'. "
        "'dynamic' starts flat and converts to HNSW past WEAVIATE_DYNAMIC_INDEX_THRESHOLD objects "
        "(requires ASYNC_INDEXING=true on the Weaviate server).",
        default="hnsw",
    )

    WEAVIATE_DYNAMIC_INDEX_THRESHOLD: PositiveInt = Field(
        description="Object count at which a dynamic index converts from flat to HNSW (default is 10000)",
        default=10000,
    )

    WEAVIATE_DISTANCE_METRIC: str = Field(
        description="Distance metric for the vector index: 'cosine', 'dot', 'l2-squared', 'manhattan', or 'hamming'",
        default="cosine",
    )

    WEAVIATE_COMPRESSION: str | None = Field(
        description="Vector quantization for new collections: None (no compression), 'rq', 'pq', 'bq', or 'sq'. "
        "A flat index supports only 'bq'.",
        default=None,
    )

    WEAVIATE_RQ_BITS: int | None = Field(
        description="Bits per dimension for RQ compression (server default when unset)",
        default=None,
    )

    WEAVIATE_PQ_SEGMENTS: int | None = Field(
        description="Number of segments for PQ compression (server default when unset)",
        default=None,
    )

    WEAVIATE_PQ_TRAINING_LIMIT: int | None = Field(
        description="Training set size limit for PQ compression (server default when unset)",
        default=None,
    )

    WEAVIATE_SQ_TRAINING_LIMIT: int | None = Field(
        description="Training set size limit for SQ compression (server default when unset)",
        default=None,
    )

    WEAVIATE_COMPRESSION_CACHE: bool | None = Field(
        description="Keep compressed vectors in cache for RQ/BQ/SQ compression (server default when unset)",
        default=None,
    )

    WEAVIATE_REPLICATION_FACTOR: PositiveInt = Field(
        description="Replication factor for new collections (default is 1)",
        default=1,
    )
