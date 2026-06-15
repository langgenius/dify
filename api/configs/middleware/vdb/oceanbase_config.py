from typing import Literal

from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class OceanBaseVectorConfig(BaseSettings):
    """
    Configuration settings for OceanBase Vector database
    """

    OCEANBASE_VECTOR_HOST: str | None = Field(
        description="Hostname or IP address of the OceanBase Vector server (e.g. 'localhost')",
        default=None,
    )

    OCEANBASE_VECTOR_PORT: PositiveInt | None = Field(
        description="Port number on which the OceanBase Vector server is listening (default is 2881)",
        default=2881,
    )

    OCEANBASE_VECTOR_USER: str | None = Field(
        description="Username for authenticating with the OceanBase Vector database",
        default=None,
    )

    OCEANBASE_VECTOR_PASSWORD: str | None = Field(
        description="Password for authenticating with the OceanBase Vector database",
        default=None,
    )

    OCEANBASE_VECTOR_DATABASE: str | None = Field(
        description="Name of the OceanBase Vector database to connect to",
        default=None,
    )

    OCEANBASE_ENABLE_HYBRID_SEARCH: bool = Field(
        description="Enable hybrid search features (requires OceanBase >= 4.3.5.1). Set to false for compatibility "
        "with older versions",
        default=False,
    )

    OCEANBASE_FULLTEXT_PARSER: str | None = Field(
        description=(
            "Fulltext parser to use for text indexing. "
            "Built-in options: 'ngram' (N-gram tokenizer for English/numbers), "
            "'beng' (Basic English tokenizer), 'space' (Space-based tokenizer), "
            "'ngram2' (Improved N-gram tokenizer), 'ik' (Chinese tokenizer). "
            "External plugins (require installation): 'japanese_ftparser' (Japanese tokenizer), "
            "'thai_ftparser' (Thai tokenizer). Default is 'ik'"
        ),
        default="ik",
    )

    OCEANBASE_VECTOR_BATCH_SIZE: PositiveInt = Field(
        description="Number of documents to insert per batch",
        default=100,
    )

    OCEANBASE_VECTOR_METRIC_TYPE: Literal["l2", "cosine", "inner_product"] = Field(
        description="Distance metric type for vector index: l2, cosine, or inner_product",
        default="l2",
    )

    OCEANBASE_HNSW_M: PositiveInt = Field(
        description="HNSW M parameter (max number of connections per node)",
        default=16,
    )

    OCEANBASE_HNSW_EF_CONSTRUCTION: PositiveInt = Field(
        description="HNSW efConstruction parameter (index build-time search width)",
        default=256,
    )

    OCEANBASE_HNSW_EF_SEARCH: int = Field(
        description="HNSW efSearch parameter (query-time search width, -1 uses server default)",
        default=-1,
    )

    OCEANBASE_VECTOR_POOL_SIZE: PositiveInt = Field(
        description="SQLAlchemy connection pool size",
        default=5,
    )

    OCEANBASE_VECTOR_MAX_OVERFLOW: int = Field(
        description="SQLAlchemy connection pool max overflow connections",
        default=10,
    )

    OCEANBASE_HNSW_REFRESH_THRESHOLD: int = Field(
        description="Minimum number of inserted documents to trigger an automatic HNSW index refresh (0 to disable)",
        default=1000,
    )
