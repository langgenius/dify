"""Configuration for Apache Doris vector database."""

from pydantic import Field, PositiveInt
from pydantic_settings import BaseSettings


class DorisVectorConfig(BaseSettings):
    """Configuration settings for Apache Doris vector database connection."""

    DORIS_HOST: str | None = Field(
        description="Hostname or IP address of the Apache Doris server.",
        default=None,
    )

    DORIS_PORT: PositiveInt = Field(
        description="Port number for Apache Doris MySQL protocol connection.",
        default=9030,
    )

    DORIS_USER: str | None = Field(
        description="Username for Apache Doris authentication.",
        default=None,
    )

    DORIS_PASSWORD: str | None = Field(
        description="Password for Apache Doris authentication.",
        default=None,
    )

    DORIS_DATABASE: str | None = Field(
        description="Database name in Apache Doris.",
        default=None,
    )

    DORIS_MAX_CONNECTION: PositiveInt = Field(
        description="Maximum number of connections in the pool.",
        default=5,
    )

    DORIS_ENABLE_TEXT_SEARCH: bool = Field(
        description="Enable full-text search with inverted indexes.",
        default=True,
    )

    DORIS_TEXT_SEARCH_ANALYZER: str | None = Field(
        description="Text search analyzer (e.g., 'english', 'chinese', 'standard').",
        default="english",
    )

    DORIS_STREAMLOAD_PORT: PositiveInt = Field(
        description="Port number for Apache Doris StreamLoad HTTP endpoint.",
        default=8030,
    )

    DORIS_STREAMLOAD_SCHEME: str = Field(
        description="HTTP scheme for StreamLoad endpoint ('http' or 'https').",
        default="http",
    )

    DORIS_STREAMLOAD_MAX_FILTER_RATIO: float = Field(
        description="Maximum ratio of filtered rows allowed in StreamLoad (0.0-1.0).",
        default=0.1,
    )

    DORIS_TABLE_REPLICATION_NUM: PositiveInt = Field(
        description="Replication number for Doris tables.",
        default=1,
    )

    DORIS_TABLE_BUCKETS: PositiveInt = Field(
        description="Number of buckets for Doris table distribution.",
        default=10,
    )
