from holo_search_sdk.types import BaseQuantizationType, DistanceType, TokenizerType
from pydantic import Field
from pydantic_settings import BaseSettings


class HologresConfig(BaseSettings):
    """
    Configuration settings for Hologres vector database.

    Hologres is compatible with PostgreSQL protocol.
    access_key_id is used as the PostgreSQL username,
    and access_key_secret is used as the PostgreSQL password.
    """

    HOLOGRES_HOST: str | None = Field(
        description="Hostname or IP address of the Hologres instance.",
        default=None,
    )

    HOLOGRES_PORT: int = Field(
        description="Port number for connecting to the Hologres instance.",
        default=80,
    )

    HOLOGRES_DATABASE: str | None = Field(
        description="Name of the Hologres database to connect to.",
        default=None,
    )

    HOLOGRES_ACCESS_KEY_ID: str | None = Field(
        description="Alibaba Cloud AccessKey ID, also used as the PostgreSQL username.",
        default=None,
    )

    HOLOGRES_ACCESS_KEY_SECRET: str | None = Field(
        description="Alibaba Cloud AccessKey Secret, also used as the PostgreSQL password.",
        default=None,
    )

    HOLOGRES_SCHEMA: str = Field(
        description="Schema name in the Hologres database.",
        default="public",
    )

    HOLOGRES_TOKENIZER: TokenizerType = Field(
        description="Tokenizer for full-text search index (e.g., 'jieba', 'ik', 'standard', 'simple').",
        default="jieba",
    )

    HOLOGRES_DISTANCE_METHOD: DistanceType = Field(
        description="Distance method for vector index (e.g., 'Cosine', 'Euclidean', 'InnerProduct').",
        default="Cosine",
    )

    HOLOGRES_BASE_QUANTIZATION_TYPE: BaseQuantizationType = Field(
        description="Base quantization type for vector index (e.g., 'rabitq', 'sq8', 'fp16', 'fp32').",
        default="rabitq",
    )

    HOLOGRES_MAX_DEGREE: int = Field(
        description="Max degree (M) parameter for HNSW vector index.",
        default=64,
    )

    HOLOGRES_EF_CONSTRUCTION: int = Field(
        description="ef_construction parameter for HNSW vector index.",
        default=400,
    )
